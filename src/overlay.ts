import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { z } from "zod";
import { ApiError, type Template } from "./templates.js";
import type { Renderer } from "./render.js";
export const fieldSchema = z.object({
  key: z.string().min(1),
  page: z.number().int().min(1).default(1),
  unit: z.enum(["percent", "pt"]).default("percent"),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  font: z.string().default("Helvetica"),
  fontSize: z.number().positive().max(300).default(24),
  minFontSize: z.number().positive().default(6),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#172b4d"),
  align: z.enum(["left", "center", "right"]).default("left"),
  autoShrink: z.boolean().default(true),
  wrap: z.boolean().default(true),
});
export const fieldsSchema = z.array(fieldSchema).max(200);
export type Field = z.infer<typeof fieldSchema>;
export function position(
  f: Pick<Field, "x" | "y" | "width" | "height" | "unit">,
  w: number,
  h: number,
) {
  const sx = f.unit === "percent" ? w / 100 : 1,
    sy = f.unit === "percent" ? h / 100 : 1;
  const box = {
    x: f.x * sx,
    y: f.y * sy,
    width: f.width * sx,
    height: f.height * sy,
  };
  if (box.x + box.width > w + 0.01 || box.y + box.height > h + 0.01)
    throw new Error("Field melewati batas halaman");
  return box;
}
export function textLayout(
  text: string,
  f: Field,
  box: { width: number; height: number },
  measure: (s: string, size: number) => number,
) {
  if (!text) return { size: f.fontSize, lines: [] as string[] };
  function linesAt(size: number) {
    if (!f.wrap) return [text.replace(/\n/g, " ")];
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const char of Array.from(paragraph)) {
        if (line && measure(line + char, size) > box.width) {
          lines.push(line.trimEnd());
          line = "";
        }
        line += char;
      }
      lines.push(line.trimEnd());
    }
    return lines;
  }
  let size = f.fontSize;
  let lines = linesAt(size);
  const fits = () =>
    lines.length * size * 1.2 <= box.height &&
    lines.every((l) => measure(l, size) <= box.width);
  if (f.autoShrink)
    while (!fits() && size > f.minFontSize) {
      size = Math.max(f.minFontSize, size - 0.5);
      lines = linesAt(size);
    }
  if (!fits())
    throw new ApiError(422, "Teks tidak muat pada field", [
      { field: f.key, message: "Perbesar kotak atau kecilkan ukuran font" },
    ]);
  return { size, lines };
}
function scalar(data: any, key: string) {
  const value = key.split(".").reduce((o, k) => o?.[k], data);
  if (value == null) return "";
  if (typeof value === "object")
    throw new ApiError(422, "Overlay membutuhkan nilai scalar", [
      { field: key, message: "Gunakan string/number/date" },
    ]);
  return String(value);
}
export async function renderOverlay(
  t: Template,
  format: "pdf" | "png",
  data: any,
  renderer: Renderer,
  customBackground?: string,
): Promise<Buffer> {
  const fields = fieldsSchema.parse(
    JSON.parse(await readFile(path.join(t.dir, "fields.json"), "utf8")),
  );
  const background = t.config.background;
  if (!background || !/^.+\.(pdf|png)$/i.test(background))
    throw new Error("Background wajib PDF/PNG");
  let bytes: Buffer;
  if (customBackground) {
    try {
      const raw = Buffer.from(customBackground.split(",")[1], "base64");
      if (raw.length > 5 * 1024 * 1024) throw new Error();
      const image = sharp(raw, { limitInputPixels: 16000000 });
      const metadata = await image.metadata();
      if (
        !["png", "jpeg"].includes(metadata.format ?? "") ||
        !metadata.width ||
        !metadata.height ||
        (metadata.pages ?? 1) > 1
      )
        throw new Error();
      bytes = await image
        .rotate()
        .resize(1684, 1190, { fit: "contain", background: "#ffffff" })
        .png()
        .toBuffer();
    } catch {
      throw new ApiError(
        422,
        "Background harus PNG/JPG valid, maksimal 5 MB dan 16 megapiksel.",
      );
    }
  } else bytes = await renderer.templates.local(t.dir, background);
  const isPdf = !customBackground && background.toLowerCase().endsWith(".pdf");
  const doc = isPdf
    ? await PDFDocument.load(bytes)
    : await PDFDocument.create();
  doc.registerFontkit(fontkit);
  if (!isPdf) {
    const m = await sharp(bytes).metadata();
    const page = doc.addPage(
      customBackground
        ? [842, 595]
        : [(m.width! * 72) / 96, (m.height! * 72) / 96],
    );
    const image = await doc.embedPng(bytes);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
    });
  }
  const fontCache = new Map<string, PDFFont>();
  async function fontFor(name: string) {
    if (fontCache.has(name)) return fontCache.get(name)!;
    const font = await doc.embedFont(
      name === "Helvetica"
        ? StandardFonts.Helvetica
        : await renderer.templates.local(renderer.templates.fonts, name),
      { subset: true },
    );
    fontCache.set(name, font);
    return font;
  }
  for (const f of fields) {
    const page = doc.getPages()[f.page - 1];
    if (!page) throw new Error(`Halaman ${f.page} tidak ada`);
    const w = page.getWidth(),
      h = page.getHeight();
    const box = position(f, w, h);
    const font = await fontFor(f.font);
    const text = scalar(data, f.key);
    let layout;
    try {
      layout = textLayout(text, f, box, (s, size) =>
        font.widthOfTextAtSize(s, size),
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(422, "Karakter tidak didukung font", [
        { field: f.key, message: "Pakai font TTF yang mendukung karakter ini" },
      ]);
    }
    const color = [1, 3, 5].map(
      (i) => parseInt(f.color.slice(i, i + 2), 16) / 255,
    );
    for (const [i, line] of layout.lines.entries()) {
      const lineWidth = font.widthOfTextAtSize(line, layout.size);
      const offset =
        f.align === "center"
          ? (box.width - lineWidth) / 2
          : f.align === "right"
            ? box.width - lineWidth
            : 0;
      page.drawText(line, {
        x: box.x + offset,
        y: h - box.y - layout.size - i * layout.size * 1.2,
        size: layout.size,
        font,
        color: rgb(color[0], color[1], color[2]),
      });
    }
  }
  if (format === "pdf") return Buffer.from(await doc.save());
  // PDF backgrounds retain all pages in PDF; PNG export is the first page at 96 dpi.
  const { rasterizePdf } = await import("./pdf-raster.js");
  return rasterizePdf(Buffer.from(await doc.save()));
}
