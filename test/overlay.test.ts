import { afterAll, expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("editor loads PDF/PNG, adds fields and exports JSON", async () => {
  const { createApp } = await import("../src/app.js");
  const { chromium } = await import("playwright");
  const app = await createApp({ logger: false });
  const browser = await chromium.launch();
  try {
    const url = await app.listen({ port: 0, host: "127.0.0.1" });
    const page = await browser.newPage();
    await page.goto(url + "/editor");
    await page
      .locator("#file")
      .setInputFiles("templates/sertifikat/background.pdf");
    await page.waitForFunction(() =>
      document
        .getElementById("status")
        ?.textContent?.includes("Klik pratinjau"),
    );
    await page.locator("#canvas").click({ position: { x: 100, y: 100 } });
    const fields = JSON.parse(await page.locator("#json").inputValue());
    expect(fields[0].unit).toBe("percent");
    expect(fields[0].key).toBe("nama");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export").click();
    expect((await downloadPromise).suggestedFilename()).toBe("fields.json");
    const png = await sharp({
      create: { width: 600, height: 300, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await page.locator("#file").setInputFiles({
      name: "background.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.waitForFunction(() => {
      const c = document.querySelector("canvas");
      return c?.width === 600;
    });
    expect(JSON.parse(await page.locator("#json").inputValue())).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
  }
}, 30000);
