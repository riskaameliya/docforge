import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ApiError } from "./templates.js";
import { Renderer } from "./render.js";
import { Batches, batchSchema } from "./batch.js";
export const requestSchema = z.object({
  template: z.string().regex(/^[\w-]+$/),
  format: z.enum(["pdf", "png"]),
  data: z.record(z.string(), z.unknown()),
});
export async function createApp(
  options: {
    renderer?: Renderer;
    apiKey?: string;
    logger?: boolean;
    batch?: boolean;
  } = {},
) {
  const key = options.apiKey ?? process.env.API_KEY;
  if (!key) throw new Error("API_KEY wajib diset");
  let batches: Batches | undefined;
  const limits = z
    .object({
      body: z.coerce.number().int().positive(),
      concurrency: z.coerce.number().int().min(1).max(32),
      batch: z.coerce.number().int().min(1).max(10000),
    })
    .parse({
      body: process.env.BODY_LIMIT ?? 1048576,
      concurrency: process.env.RENDER_CONCURRENCY ?? 2,
      batch: process.env.BATCH_LIMIT ?? 100,
    });
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: limits.body,
    requestTimeout: 30000,
  });
  const renderer =
    options.renderer ?? new Renderer(undefined, limits.concurrency);
  app.addHook("onRequest", async (req) => {
    if (
      req.url === "/health" ||
      [
        "/editor",
        "/editor.js",
        "/editor-vendor/pdf.mjs",
        "/editor-vendor/pdf.worker.mjs",
      ].includes(req.url)
    )
      return;
    const provided = req.headers["x-api-key"];
    if (
      typeof provided !== "string" ||
      Buffer.byteLength(provided) !== Buffer.byteLength(key) ||
      !timingSafeEqual(Buffer.from(provided), Buffer.from(key))
    )
      throw new ApiError(401, "API key tidak valid");
  });
  app.setErrorHandler((err: any, req, reply) => {
    const status = err instanceof z.ZodError ? 422 : (err.statusCode ?? 500);
    if (status >= 500) req.log.error({ err }, "Request gagal");
    reply.code(status).send({
      error: {
        code: status,
        message: status >= 500 ? "Kesalahan internal" : err.message,
        fields:
          err instanceof z.ZodError
            ? err.issues.map((i) => ({
                field: i.path.join("."),
                message: i.message,
              }))
            : err.fields,
      },
    });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply
      .code(404)
      .send({ error: { code: 404, message: "Endpoint tidak ditemukan" } }),
  );
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/templates", () => renderer.templates.list());
  app.get<{ Params: { id: string } }>("/templates/:id", async (req) => {
    const t = await renderer.templates.load(req.params.id);
    return {
      id: t.id,
      schema: t.schema,
      sampleData: t.sample,
      config: t.config,
    };
  });
  app.post("/generate", async (req, reply) => {
    const b = requestSchema.parse(req.body);
    const result = await renderer.generate(b.template, b.format, b.data);
    return reply
      .type(b.format === "pdf" ? "application/pdf" : "image/png")
      .header(
        "Content-Disposition",
        `attachment; filename="${b.template}.${b.format}"`,
      )
      .send(result);
  });
  if (options.batch ?? !!process.env.REDIS_URL) {
    const service = (batches = new Batches(renderer));
    service.worker.on("error", (err) =>
      app.log.error({ err }, "Batch worker error"),
    );
    service.queue.on("error", (err) =>
      app.log.error({ err }, "Batch queue error"),
    );
    service.worker.on("failed", (job, err) =>
      app.log.error({ jobId: job?.id, err }, "Batch job failed"),
    );
    app.post("/generate/batch", async (req, reply) =>
      reply
        .code(202)
        .send(await service.submit(batchSchema(limits.batch).parse(req.body))),
    );
    app.get<{ Params: { id: string } }>("/jobs/:id", (req) =>
      service.status(req.params.id),
    );
    app.get<{ Params: { id: string } }>(
      "/jobs/:id/download",
      async (req, reply) => {
        const stream = await service.download(req.params.id);
        return reply
          .type("application/zip")
          .header(
            "Content-Disposition",
            `attachment; filename="batch-${req.params.id}.zip"`,
          )
          .send(stream);
      },
    );
  }
  app.get("/editor", async (_req, reply) =>
    reply.type("text/html").send(await readFile("public/editor.html")),
  );
  app.get("/editor.js", async (_req, reply) =>
    reply.type("text/javascript").send(await readFile("public/editor.js")),
  );
  for (const name of ["pdf.mjs", "pdf.worker.mjs"])
    app.get(`/editor-vendor/${name}`, async (_req, reply) =>
      reply
        .type("text/javascript")
        .send(await readFile(`node_modules/pdfjs-dist/build/${name}`)),
    );
  app.addHook("onClose", async () => {
    await batches?.close();
    await renderer.close();
  });
  return app;
}
