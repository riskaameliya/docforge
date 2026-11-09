import { afterAll, expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { Renderer } from "../src/render.js";
import { Batches, batchSchema, safeFilename } from "../src/batch.js";
import { createApp } from "../src/app.js";
const r = new Renderer();
afterAll(() => r.close());
test("batch limits and safe unique names", () => {
  expect(() =>
    batchSchema(2).parse({
      template: "sertifikat",
      format: "pdf",
      data: [{}, {}, {}],
    }),
  ).toThrow();
  expect(safeFilename("../../A/B", 0, "pdf")).toBe("0001-_A_B.pdf");
  expect(safeFilename("A/B", 1, "pdf")).not.toBe(safeFilename("A/B", 0, "pdf"));
});
test("real Redis queue, partial failure, progress and ZIP", async () => {
  if (!process.env.REDIS_URL)
    throw new Error(
      "Set REDIS_URL untuk tes integrasi batch (Redis nyata wajib tersedia)",
    );
  const root = await mkdtemp(path.join(os.tmpdir(), "docforge-batch-"));
  const batches = new Batches(
    r,
    process.env.REDIS_URL,
    root,
    `test-${Date.now()}`,
  );
  batches.worker.on("error", () => {});
  batches.queue.on("error", () => {});
  try {
    await batches.worker.waitUntilReady();
    const t = await r.templates.load("sertifikat");
    const job = await batches.submit({
      template: t.id,
      format: "pdf",
      filenameField: "nama",
      data: [t.sample, { nama: "" }, { ...t.sample, nama: "Dr. Éka, S.T." }],
    });
    let status = await batches.status(job.id!);
    const deadline = Date.now() + 20000;
    while (
      !["completed", "failed"].includes(status.state) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = await batches.status(job.id!);
    }
    expect(status.state).toBe("completed");
    expect(status.progress).toBe(100);
    expect(status.result.succeeded).toBe(2);
    expect(status.result.failures[0].index).toBe(1);
    const files = unzipSync(await readFile(batches.filename(job.id!)));
    expect(Object.keys(files)).toHaveLength(3);
    expect(Buffer.from(files["report.json"]).toString()).toContain("failures");
    for (const [name, bytes] of Object.entries(files))
      if (name.endsWith(".pdf"))
        expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    await batches.download(job.id!).then((s) => s.destroy());
    await expect(batches.status("missing")).rejects.toMatchObject({
      statusCode: 404,
    });
  } finally {
    await batches.queue.obliterate({ force: true });
    await batches.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
test("batch HTTP endpoints", async () => {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL required");
  const app = await createApp({ apiKey: "test", logger: false, batch: true });
  try {
    const headers = { "x-api-key": "test" };
    const t = await r.templates.load("sertifikat");
    const submit = await app.inject({
      method: "POST",
      url: "/generate/batch",
      headers,
      payload: {
        template: t.id,
        format: "png",
        data: [t.sample, {}],
        filenameField: "nomor",
      },
    });
    expect(submit.statusCode).toBe(202);
    const { id } = submit.json();
    let status;
    for (let i = 0; i < 200; i++) {
      status = (await app.inject({ url: `/jobs/${id}`, headers })).json();
      if (status.state === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status.progress).toBe(100);
    expect(status.result.failures).toHaveLength(1);
    const download = await app.inject({ url: `/jobs/${id}/download`, headers });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/zip");
    expect(download.rawPayload.subarray(0, 2).toString()).toBe("PK");
  } finally {
    await app.close();
  }
}, 30000);
