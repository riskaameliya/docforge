import { test, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createApp } from "../src/app.js";
import sharp from "sharp";
import { unzipSync } from "fflate";
test("letter custom layout supports letterhead, PDF coordinates, blank page, PNG and batch without changing default HTML", async () => {
  const app = await createApp({ logger: false });
  const image = await sharp({
    create: { width: 1000, height: 150, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  const field = {
    key: "isi",
    label: "Isi surat",
    type: "string",
    required: true,
    x: 10,
    y: 30,
    width: 80,
    height: 40,
    fontSize: 12,
    color: "#172b4d",
    align: "left",
  };
  const payload = {
    template: "surat-resmi",
    format: "pdf",
    background: `data:image/png;base64,${image.toString("base64")}`,
    letterFields: [field],
    data: { isi: "Isi surat milik pengguna" },
  };
  try {
    const pdf = await app.inject({ method: "POST", url: "/generate", payload });
    expect(pdf.statusCode).toBe(200);
    const page = (await PDFDocument.load(pdf.rawPayload)).getPages()[0];
    expect(page.getWidth()).toBe(595);
    expect(page.getHeight()).toBe(842);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(pdf.rawPayload) });
    try {
      const doc = await task.promise;
      const content = await (await doc.getPage(1)).getTextContent();
      const text: any = content.items.find(
        (item: any) => item.str === payload.data.isi,
      );
      expect(text.transform[4]).toBeCloseTo(59.5, 1);
      expect(text.transform[5]).toBeCloseTo(842 - 842 * 0.3 - 12, 1);
    } finally {
      await task.destroy();
    }
    const png = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { ...payload, format: "png" },
    });
    expect(png.statusCode).toBe(200);
    const pixel = await sharp(png.rawPayload)
      .extract({ left: 5, top: 5, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...pixel]).toEqual([255, 0, 0]);
    const blank = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { ...payload, background: undefined },
    });
    expect(blank.statusCode).toBe(200);
    const batch = await app.inject({
      method: "POST",
      url: "/generate/batch",
      payload: { ...payload, data: [payload.data] },
    });
    expect(batch.statusCode).toBe(200);
    expect(Object.keys(unzipSync(batch.rawPayload))).toContain(
      "0001-document.pdf",
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/generate",
          payload: { ...payload, data: {} },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/generate",
          payload: { ...payload, template: "sertifikat" },
        })
      ).statusCode,
    ).toBe(422);
    const template = (await app.inject("/templates/surat-resmi")).json();
    const builtin = await app.inject({
      method: "POST",
      url: "/generate",
      payload: {
        template: "surat-resmi",
        format: "pdf",
        data: template.sampleData,
      },
    });
    expect(builtin.statusCode).toBe(200);
    expect(
      (await PDFDocument.load(builtin.rawPayload)).getPages()[0].getHeight(),
    ).toBeCloseTo(841.89, 1);
  } finally {
    await app.close();
  }
}, 30000);
