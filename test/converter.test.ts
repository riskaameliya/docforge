import { expect, test } from "vitest";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { chromium } from "playwright";
import ts from "typescript";
import { runInNewContext } from "node:vm";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  exportTemplate,
  validIdentifier,
  type PdfPage,
} from "../public/template-export.js";
import { createApp } from "../src/app.js";
import { Renderer } from "../src/render.js";
import { Templates } from "../src/templates.js";
const pixel =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=";
const page: PdfPage = {
  width: 400,
  height: 500,
  background: pixel,
  texts: [
    {
      id: "t1",
      text: "Nomor: 001/2026",
      x: 40,
      y: 60,
      width: 180,
      height: 12,
      fontSize: 12,
      family: "serif",
    },
    {
      id: "t2",
      text: "Literal ` ${globalThis.injected=true} {{danger}} <script>x</script>",
      x: 40,
      y: 90,
      width: 300,
      height: 12,
      fontSize: 12,
      family: "sans-serif",
    },
  ],
};
test("exported TypeScript executes, escapes data and preserves partial text", async () => {
  const result = exportTemplate(
    [page],
    [
      {
        id: "t1",
        key: "nomorSurat",
        source: "001/2026",
        type: "string",
        required: true,
        sample: "002/2026",
      },
    ],
    "TemplateSurat",
  );
  expect(result.html).toContain("Nomor: {{nomorSurat}}");
  expect(result.html).toContain("&#123;&#123;danger&#125;&#125;");
  expect(result.preview).toContain("Nomor: 002/2026");
  expect(result.schema.fields.nomorSurat.required).toBe(true);
  const compiled = ts.transpileModule(result.typescript, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    reportDiagnostics: true,
  });
  expect(compiled.diagnostics).toEqual([]);
  const commonjs = ts.transpileModule(result.typescript, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const sandbox = { exports: {} };
  runInNewContext(commonjs, sandbox);
  const module = sandbox.exports as any;
  const html = module.TemplateSurat({
    nomorSurat: "<img src=x onerror=alert(1)>",
  });
  expect(html).toContain("&lt;img");
  expect(html).not.toContain("<img src=x");
  expect((globalThis as any).injected).toBeUndefined();
  expect((sandbox as any).injected).toBeUndefined();
});
test("invalid identifiers, missing source and invalid dates are rejected", () => {
  expect(validIdentifier("class")).toBe(false);
  expect(() => exportTemplate([page], [], "bad-name")).toThrow();
  expect(() =>
    exportTemplate(
      [page],
      [
        {
          id: "t1",
          key: "nomor",
          source: "absent",
          type: "string",
          required: true,
          sample: "A",
        },
      ],
    ),
  ).toThrow();
  expect(() =>
    exportTemplate(
      [page],
      [
        {
          id: "t1",
          key: "tanggal",
          type: "date",
          required: true,
          sample: "2026-02-30",
        },
      ],
    ),
  ).toThrow();
});

test("browser converts multipage PDF, exports usable TS and installs template ZIP", async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([400, 500]);
    p.drawRectangle({
      x: 0,
      y: 450,
      width: 400,
      height: 50,
      color: rgb(0.2, 0.4, 0.3),
    });
    p.drawText(i === 0 ? "Nomor: 001/2026" : "Lampiran peserta", {
      x: 40,
      y: 415,
      size: 16,
      font,
    });
    p.drawText("Nama Peserta", { x: 40, y: 370, size: 12, font });
  }
  const app = await createApp({
    apiKey: "converter-test",
    logger: false,
    batch: false,
  });
  const browser = await chromium.launch();
  const root = await mkdtemp(path.join(os.tmpdir(), "docforge-converter-"));
  const renderer = new Renderer(new Templates(root));
  try {
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const ui = await browser.newPage({
      viewport: { width: 1400, height: 1100 },
    });
    const errors: string[] = [];
    ui.on("pageerror", (e) => errors.push(e.message));
    await ui.goto(base + "/converter");
    await ui.locator("#pdf-file").setInputFiles({
      name: "surat-pemanggilan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(await doc.save()),
    });
    await ui.waitForFunction(
      () => document.getElementById("page-label")?.textContent === "1 / 2",
    );
    expect(await ui.locator(".text-hit").count()).toBe(2);
    await ui
      .getByRole("button", {
        name: "Jadikan variabel: Nomor: 001/2026",
        exact: true,
      })
      .click();
    await ui.getByLabel("Nama variabel", { exact: true }).fill("nomorSurat");
    await ui
      .getByLabel("Bagian teks yang diganti", { exact: true })
      .fill("001/2026");
    await ui
      .getByLabel("Contoh nilai / pratinjau", { exact: true })
      .fill("999/2026");
    await ui
      .getByLabel("Nama fungsi TypeScript")
      .fill("TemplateSuratPemanggilan");
    await ui.getByRole("tab", { name: "TypeScript", exact: true }).click();
    expect(await ui.locator("#code-output").inputValue()).toContain(
      "export const TemplateSuratPemanggilan",
    );
    await ui.getByRole("tab", { name: "Pratinjau HTML" }).click();
    await ui.waitForFunction(() =>
      document
        .getElementById("html-preview")
        ?.getAttribute("srcdoc")
        ?.includes("999/2026"),
    );
    const frame = ui.frameLocator("#html-preview");
    expect(await frame.locator(".pdf-variable").innerText()).toBe(
      "Nomor: 999/2026",
    );
    const background = await frame
      .locator(".pdf-background")
      .first()
      .getAttribute("src");
    const bytes = Buffer.from(background!.split(",")[1], "base64");
    const cropBytes = await sharp(bytes)
      .extract({ left: 60, top: 100, width: 260, height: 40 })
      .toBuffer();
    const crop = await sharp(cropBytes).stats();
    expect(crop.channels[0].mean).toBeGreaterThan(254); // text is removed from raster background
    const event = ui.waitForEvent("download");
    await ui.locator("#download-package").click();
    const download = await event;
    const archive = path.join(root, "template.zip");
    await download.saveAs(archive);
    const files = unzipSync(await readFile(archive));
    expect(Object.keys(files)).toContain("TemplateSuratPemanggilan.ts");
    expect(Object.keys(files)).toContain("example.ts");
    const target = path.join(root, "converted");
    await mkdir(target);
    for (const filename of [
      "template.html",
      "schema.json",
      "sample-data.json",
      "config.json",
    ])
      await writeFile(path.join(target, filename), files[filename]);
    const result = await renderer.generate("converted", "pdf", {
      nomorSurat: "123/2026",
    });
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
    const generatedTs = Buffer.from(
      files["TemplateSuratPemanggilan.ts"],
    ).toString();
    const tsFile = path.join(root, "generated.ts");
    await writeFile(tsFile, generatedTs);
    const program = ts.createProgram([tsFile], {
      noEmit: true,
      strict: true,
      noUncheckedIndexedAccess: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      skipLibCheck: true,
      types: [],
    });
    expect(
      ts
        .getPreEmitDiagnostics(program)
        .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")),
    ).toEqual([]);

    const sandbox = { exports: {} };
    runInNewContext(
      ts.transpileModule(generatedTs, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      sandbox,
    );
    const module = sandbox.exports as any;
    expect(
      module.TemplateSuratPemanggilan({ nomorSurat: "888/2026" }),
    ).toContain("Nomor: 888/2026");
    await ui.locator("#next-page").click();
    expect(await ui.locator("#page-label").innerText()).toBe("2 / 2");
    await ui.locator("#html-preview").scrollIntoViewIfNeeded();
    await frame
      .locator(".pdf-page")
      .first()
      .screenshot({ path: "/tmp/docforge-converter-html.png" });
    await ui.screenshot({
      path: "/tmp/docforge-converter-desktop.png",
      fullPage: true,
    });
    await ui.setViewportSize({ width: 390, height: 844 });
    expect(
      await ui.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await ui.screenshot({
      path: "/tmp/docforge-converter-mobile.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await renderer.close();
    await browser.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
