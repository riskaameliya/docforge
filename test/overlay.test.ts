import { afterAll, expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";
import { Renderer } from "../src/render.js";
import { Templates } from "../src/templates.js";
import { fieldSchema, position, textLayout } from "../src/overlay.js";
const r = new Renderer();
afterAll(() => r.close());
test("top-left percent and point positions, bounds", () => {
  expect(
    position(
      { unit: "percent", x: 10, y: 20, width: 50, height: 10 },
      600,
      800,
    ),
  ).toEqual({ x: 60, y: 160, width: 300, height: 80 });
  expect(
    position({ unit: "pt", x: 10, y: 20, width: 50, height: 10 }, 600, 800).y,
  ).toBe(20);
  expect(() =>
    position({ unit: "percent", x: 95, y: 0, width: 10, height: 10 }, 600, 800),
  ).toThrow();
});
test("wrap, shrink, empty, and overflow", () => {
  const f = fieldSchema.parse({
    key: "nama",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  const layout = textLayout(
    "teks panjang ".repeat(10),
    f,
    { width: 100, height: 100 },
    (s, size) => (s.length * size) / 2,
  );
  expect(layout.size).toBeLessThan(24);
  expect(layout.lines.length).toBeGreaterThan(1);
  expect(textLayout("", f, { width: 100, height: 100 }, () => 0).lines).toEqual(
    [],
  );
  expect(() =>
    textLayout(
      "x".repeat(10000),
      f,
      { width: 10, height: 10 },
      (s, size) => s.length * size,
    ),
  ).toThrow();
});
for (const format of ["pdf", "png"] as const)
  test(`certificate ${format}`, async () => {
    const t = await r.templates.load("sertifikat");
    const b = await r.generate(t.id, format, t.sample);
    if (format === "pdf") {
      expect(b.subarray(0, 5).toString()).toBe("%PDF-");
      expect((await PDFDocument.load(b)).getPageCount()).toBe(1);
    } else {
      const meta = await sharp(b).metadata();
      expect(meta.format).toBe("png");
      expect(meta.width).toBeGreaterThan(1000);
    }
  }, 30000);
test("PNG background exports PDF/PNG and missing optional field", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docforge-overlay-"));
  const dir = path.join(root, "test");
  await import("node:fs/promises").then((m) => m.mkdir(dir));
  const local = new Renderer(new Templates(root));
  try {
    await writeFile(
      path.join(dir, "background.png"),
      await sharp({
        create: { width: 800, height: 400, channels: 3, background: "#fff" },
      })
        .png()
        .toBuffer(),
    );
    await Promise.all(
      Object.entries({
        "config.json": { type: "overlay", background: "background.png" },
        "schema.json": {
          fields: {
            nama: { type: "string", required: true },
            empty: { type: "string" },
          },
        },
        "sample-data.json": { nama: "Dr. Éka, S.T." },
        "fields.json": [
          { key: "nama", x: 10, y: 10, width: 80, height: 30, fontSize: 22 },
          { key: "empty", x: 10, y: 50, width: 80, height: 20 },
        ],
      }).map(([file, value]) =>
        writeFile(path.join(dir, file), JSON.stringify(value)),
      ),
    );
    for (const format of ["pdf", "png"] as const) {
      const b = await local.generate("test", format, { nama: "Dr. Éka, S.T." });
      expect(b.length).toBeGreaterThan(500);
      if (format === "pdf")
        expect((await PDFDocument.load(b)).getPageCount()).toBe(1);
      else expect((await sharp(b).metadata()).width).toBe(800);
    }
  } finally {
    await local.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test("uploaded certificate background stays request-local, validates images and supports batch", async () => {
  const app = await createApp({ logger: false });
  const { readFile } = await import("node:fs/promises");
  const { unzipSync } = await import("fflate");
  const original = await readFile("templates/sertifikat/background.pdf");
  const t = await r.templates.load("sertifikat");
  const bytes = await sharp({
    create: { width: 1684, height: 1190, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  const background = `data:image/png;base64,${bytes.toString("base64")}`;
  const payload = { template: t.id, format: "png", data: t.sample, background };
  try {
    const response = await app.inject({
      method: "POST",
      url: "/generate",
      payload,
    });
    expect(response.statusCode).toBe(200);
    const pixel = await sharp(response.rawPayload)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual([255, 0, 0]);
    const pdf = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { ...payload, format: "pdf" },
    });
    const page = (await PDFDocument.load(pdf.rawPayload)).getPages()[0];
    expect(page.getWidth()).toBe(842);
    expect(page.getHeight()).toBe(595);
    const batch = await app.inject({
      method: "POST",
      url: "/generate/batch",
      payload: { ...payload, format: "pdf", data: [t.sample] },
    });
    expect(batch.statusCode).toBe(200);
    expect(Object.keys(unzipSync(batch.rawPayload))).toContain(
      "0001-document.pdf",
    );
    expect(await readFile("templates/sertifikat/background.pdf")).toEqual(
      original,
    );
    const builtin = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { ...payload, background: undefined },
    });
    const builtinPixel = await sharp(builtin.rawPayload)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...builtinPixel]).not.toEqual([255, 0, 0]);
    const square = `data:image/png;base64,${(
      await sharp({
        create: { width: 500, height: 500, channels: 3, background: "#00ff00" },
      })
        .png()
        .toBuffer()
    ).toString("base64")}`;
    const squareResponse = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { ...payload, background: square },
    });
    expect(squareResponse.statusCode).toBe(200);
    const center = await sharp(squareResponse.rawPayload)
      .extract({ left: 550, top: 50, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...center]).toEqual([0, 255, 0]);
    for (const invalid of ["data:image/png;base64,YmFk"]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/generate",
            payload: { ...payload, background: invalid },
          })
        ).statusCode,
      ).toBe(422);
    }
    const other = await r.templates.load("laporan");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/generate",
          payload: { ...payload, template: other.id, data: other.sample },
        })
      ).statusCode,
    ).toBe(422);
  } finally {
    await app.close();
  }
}, 30000);
