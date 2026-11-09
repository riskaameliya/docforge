import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile, mkdir } from "node:fs/promises";
const doc = await PDFDocument.create();
const page = doc.addPage([842, 595]);
const font = await doc.embedFont(StandardFonts.TimesRomanBold);
page.drawRectangle({
  x: 0,
  y: 0,
  width: 842,
  height: 595,
  color: rgb(0.97, 0.96, 0.92),
});
page.drawRectangle({
  x: 20,
  y: 20,
  width: 802,
  height: 555,
  borderColor: rgb(0.15, 0.3, 0.4),
  borderWidth: 4,
});
page.drawRectangle({
  x: 30,
  y: 30,
  width: 782,
  height: 535,
  borderColor: rgb(0.7, 0.55, 0.25),
  borderWidth: 1,
});
for (const [text, y, size] of [
  ["SERTIFIKAT", 460, 42],
  ["PENGHARGAAN", 418, 20],
  ["Diberikan kepada:", 350, 14],
  ["Atas partisipasi dalam kegiatan", 235, 14],
  ["Direktur DocForge Indonesia", 90, 14],
] as const)
  page.drawText(text, {
    x: (842 - font.widthOfTextAtSize(text, size)) / 2,
    y,
    size,
    font,
    color: rgb(0.15, 0.3, 0.4),
  });
await mkdir("templates/sertifikat", { recursive: true });
await writeFile("templates/sertifikat/background.pdf", await doc.save());
