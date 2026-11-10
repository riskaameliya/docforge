import { defaultLetterFields } from "./letter.js";
import {
  certificateFieldsSchema,
  defaultCertificateFields,
} from "./certificate.js";
import { reportColumnsSchema } from "./report.js";
import Fastify from "fastify";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ApiError } from "./templates.js";
import { Renderer, Limiter } from "./render.js";
import { processBatch, batchSchema, backgroundSchema } from "./batch.js";
export const requestSchema = z.object({
  template: z.string().regex(/^[\w-]+$/),
  format: z.enum(["pdf", "png"]),
  background: backgroundSchema,
  columns: reportColumnsSchema.optional(),
  certificateFields: certificateFieldsSchema.optional(),
  letterFields: certificateFieldsSchema.optional(),
  data: z.record(z.string(), z.unknown()),
});
export async function createApp(
  options: {
    renderer?: Renderer;
    logger?: boolean;
  } = {},
) {
  const batchLimiter = new Limiter(1, 2);
  const clients = new Map<string, { count: number; reset: number }>();
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
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    if (!req.url.startsWith("/generate")) return;
    const now = Date.now();
    for (const [ip, entry] of clients)
      if (entry.reset <= now) clients.delete(ip);
    let entry = clients.get(req.ip);
    if (!entry) {
      if (clients.size >= 10000)
        throw new ApiError(503, "Layanan sedang penuh");
      clients.set(req.ip, (entry = { count: 0, reset: now + 60000 }));
    }
    if (++entry.count > 60) {
      reply.header(
        "Retry-After",
        String(Math.ceil((entry.reset - now) / 1000)),
      );
      throw new ApiError(429, "Terlalu banyak permintaan. Coba lagi sebentar.");
    }
  });
  app.setErrorHandler((err: any, req, reply) => {
    const status = err instanceof z.ZodError ? 422 : (err.statusCode ?? 500);
    if (status >= 500) req.log.error({ statusCode: status }, "Request gagal");
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
      letterFields: t.id === "surat-resmi" ? defaultLetterFields : undefined,
      certificateFields:
        t.id === "sertifikat" ? defaultCertificateFields : undefined,
    };
  });
  app.post("/generate", { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const b = requestSchema.parse(req.body);
    const result = await renderer.generate(
      b.template,
      b.format,
      b.data,
      b.background,
      b.columns,
      b.certificateFields,
      b.letterFields,
    );
    return reply
      .type(b.format === "pdf" ? "application/pdf" : "image/png")
      .header(
        "Content-Disposition",
        `attachment; filename="${b.template}.${b.format}"`,
      )
      .send(result);
  });
  app.post(
    "/generate/batch",
    { bodyLimit: 8 * 1024 * 1024 },
    async (req, reply) => {
      const input = batchSchema(limits.batch).parse(req.body);
      const bytes = await batchLimiter.run(() => processBatch(input, renderer));
      return reply
        .type("application/zip")
        .header("Content-Disposition", 'attachment; filename="batch.zip"')
        .send(bytes);
    },
  );
  for (const [url, file, type] of [
    ["/", "public/index.html", "text/html; charset=utf-8"],
    ["/logo-mark.svg", "public/assets/logo-mark.svg", "image/svg+xml"],
    ["/mascot.webp", "public/assets/mascot.webp", "image/webp"],
    ["/ui.css", "public/ui.css", "text/css"],
    ["/ui.js", "public/ui.js", "text/javascript"],
    ["/ui-font.ttf", "fonts/NotoSans-Regular.ttf", "font/ttf"],
    ["/converter", "public/converter.html", "text/html; charset=utf-8"],
    ["/converter.css", "public/converter.css", "text/css"],
    ["/converter.js", "public/converter.js", "text/javascript"],
    ["/template-export.js", "public/template-export.js", "text/javascript"],
    [
      "/converter-vendor/fflate.js",
      "node_modules/fflate/esm/browser.js",
      "text/javascript",
    ],
  ]) {
    app.get(url, async (_req, reply) =>
      reply.type(type).send(await readFile(file)),
    );
  }
  for (const name of ["pdf.mjs", "pdf.worker.mjs"])
    app.get(`/pdf-vendor/${name}`, async (_req, reply) =>
      reply
        .type("text/javascript")
        .send(await readFile(`node_modules/pdfjs-dist/build/${name}`)),
    );
  app.addHook("onClose", async () => {
    await renderer.close();
  });
  return app;
}
