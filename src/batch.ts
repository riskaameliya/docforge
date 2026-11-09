import { Queue, Worker, type Job } from "bullmq";
import { createWriteStream, createReadStream } from "node:fs";
import { once } from "node:events";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Zip, ZipPassThrough } from "fflate";
import { z } from "zod";
import { ApiError } from "./templates.js";
import type { Renderer } from "./render.js";
export const batchSchema = (limit: number) =>
  z.object({
    template: z.string().regex(/^[\w-]+$/),
    format: z.enum(["pdf", "png"]),
    data: z.array(z.record(z.string(), z.unknown())).min(1).max(limit),
    filenameField: z.string().max(100).optional(),
  });
export type BatchInput = z.infer<ReturnType<typeof batchSchema>>;
export type BatchResult = {
  total: number;
  succeeded: number;
  failures: Array<{ index: number; message: string; fields?: unknown }>;
};
export function safeFilename(value: unknown, index: number, format: string) {
  const name =
    String(value ?? "document")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .slice(0, 80) || "document";
  return `${String(index + 1).padStart(4, "0")}-${name}.${format}`;
}
export async function processBatch(
  input: BatchInput,
  renderer: Renderer,
  output: string,
  progress: (n: number) => Promise<unknown>,
): Promise<BatchResult> {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = output + ".tmp";
  const stream = createWriteStream(temporary);
  let streamError: Error | undefined;
  stream.on("error", (e) => {
    streamError = e;
  });
  const zip = new Zip((error, chunk, final) => {
    if (error) {
      streamError = error;
      stream.destroy(error);
      return;
    }
    if (!streamError) stream.write(chunk);
    if (final) stream.end();
  });
  const done = new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  void done.catch(() => {});
  const result: BatchResult = {
    total: input.data.length,
    succeeded: 0,
    failures: [],
  };
  const append = (name: string, bytes: Uint8Array) => {
    const file = new ZipPassThrough(name);
    zip.add(file);
    file.push(bytes, true);
  };
  try {
    for (const [index, data] of input.data.entries()) {
      try {
        const bytes = await renderer.generate(
          input.template,
          input.format,
          data,
        );
        append(
          safeFilename(
            input.filenameField ? data[input.filenameField] : undefined,
            index,
            input.format,
          ),
          bytes,
        );
        result.succeeded++;
      } catch (e: any) {
        result.failures.push({
          index,
          message: e instanceof ApiError ? e.message : "Render gagal",
          fields: e instanceof ApiError ? e.fields : undefined,
        });
      }
      if (streamError) throw streamError;
      if (stream.writableNeedDrain) await once(stream, "drain");
      await progress(Math.round(((index + 1) / input.data.length) * 100));
    }
    append("report.json", Buffer.from(JSON.stringify(result, null, 2)));
    zip.end();
    await done;
    await rename(temporary, output);
    return result;
  } catch (e) {
    zip.terminate();
    stream.destroy();
    await rm(temporary, { force: true });
    throw e;
  }
}
export class Batches {
  readonly queue: Queue;
  readonly worker: Worker;
  readonly output: string;
  constructor(
    private renderer: Renderer,
    redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379",
    output = process.env.OUTPUT_DIR ?? "output",
    queueName = "docforge",
  ) {
    const url = new URL(redisUrl);
    if (!["redis:", "rediss:"].includes(url.protocol))
      throw new Error("REDIS_URL tidak valid");
    const connection = {
      host: url.hostname,
      port: Number(url.port || 6379),
      username: decodeURIComponent(url.username) || undefined,
      password: decodeURIComponent(url.password) || undefined,
      db: Number(url.pathname.slice(1) || 0),
      maxRetriesPerRequest: null,
      tls: url.protocol === "rediss:" ? {} : undefined,
    };
    this.output = path.resolve(output);
    this.queue = new Queue(queueName, {
      connection: { ...connection, maxRetriesPerRequest: 1 },
      defaultJobOptions: {
        removeOnComplete: { age: 86400, count: 1000 },
        removeOnFail: { age: 86400, count: 1000 },
      },
    });
    this.worker = new Worker(
      queueName,
      async (job: Job<BatchInput>) =>
        processBatch(job.data, this.renderer, this.filename(job.id!), (n) =>
          job.updateProgress(n),
        ),
      { connection, concurrency: 1 },
    );
  }
  filename(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new ApiError(404, "Job tidak ditemukan");
    return path.join(this.output, `${id}.zip`);
  }
  async submit(input: BatchInput) {
    await this.renderer.templates.load(input.template);
    const job = await this.queue.add("generate", input);
    return { id: job.id, statusUrl: `/jobs/${job.id}` };
  }
  async status(id: string) {
    this.filename(id);
    const job = await this.queue.getJob(id);
    if (!job) throw new ApiError(404, "Job tidak ditemukan");
    const state = await job.getState();
    return {
      id,
      state,
      progress: job.progress,
      result: state === "completed" ? job.returnvalue : undefined,
      error: state === "failed" ? "Batch gagal; periksa log server" : undefined,
      downloadUrl: state === "completed" ? `/jobs/${id}/download` : undefined,
    };
  }
  async download(id: string) {
    const job = await this.status(id);
    if (job.state !== "completed") throw new ApiError(409, "Job belum selesai");
    try {
      await stat(this.filename(id));
    } catch (e: any) {
      if (e.code === "ENOENT") throw new ApiError(410, "Arsip tidak tersedia");
      throw e;
    }
    return createReadStream(this.filename(id));
  }
  async close() {
    await this.worker.close();
    await this.queue.close();
  }
}
