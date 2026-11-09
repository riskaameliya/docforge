import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
// PDF.js uses the same canvas implementation in tests and production, without Chromium scripts.
Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
export async function rasterizePdf(bytes: Buffer) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    standardFontDataUrl: pathToFileURL(
      path.resolve("node_modules/pdfjs-dist/standard_fonts") + "/",
    ).href,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 96 / 72 });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    await page.render({
      canvas: canvas as any,
      canvasContext: canvas.getContext("2d") as any,
      viewport,
    }).promise;
    return sharp(canvas.toBuffer("image/png")).png().toBuffer();
  } finally {
    await task.destroy();
  }
}
