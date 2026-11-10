import { afterAll, expect, test } from "vitest";
import { unzipSync } from "fflate";
import { Renderer } from "../src/render.js";
import { batchSchema, safeFilename } from "../src/batch.js";
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
test("public batch returns ZIP directly, with partial failures and no job URLs", async () => {
  const app = await createApp({ logger: false });
  try {
    const t = await r.templates.load("sertifikat");
    const response = await app.inject({
      method: "POST",
      url: "/generate/batch",
      payload: {
        template: t.id,
        format: "pdf",
        filenameField: "nama",
        data: [t.sample, { nama: "" }, { ...t.sample, nama: "Dr. Éka" }],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-disposition"]).toContain("attachment");
    const files = unzipSync(response.rawPayload);
    expect(Object.keys(files)).toHaveLength(3);
    const report = JSON.parse(Buffer.from(files["report.json"]).toString());
    expect(report.succeeded).toBe(2);
    expect(report.failures[0].index).toBe(1);
    for (const [name, bytes] of Object.entries(files))
      if (name.endsWith(".pdf"))
        expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await app.inject("/jobs/1")).statusCode).toBe(404);
    expect((await app.inject("/jobs/1/download")).statusCode).toBe(404);
    const invalid = await app.inject({
      method: "POST",
      url: "/generate/batch",
      payload: { template: t.id, format: "pdf", data: [] },
    });
    expect(invalid.statusCode).toBe(422);
  } finally {
    await app.close();
  }
}, 30000);

test("public generation rate limit applies and does not block static assets", async () => {
  const app = await createApp({ logger: false });
  try {
    for (let i = 0; i < 60; i++)
      expect(
        (await app.inject({ method: "POST", url: "/generate", payload: {} }))
          .statusCode,
      ).toBe(422);
    const limited = await app.inject({
      method: "POST",
      url: "/generate",
      payload: {},
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect((await app.inject("/")).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
