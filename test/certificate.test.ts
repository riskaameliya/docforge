import { test, expect } from "vitest";
import { createApp } from "../src/app.js";
import { certificateFieldsSchema } from "../src/certificate.js";
import { unzipSync } from "fflate";
import sharp from "sharp";
const field = {
  key: "instansi",
  label: "Instansi",
  type: "string" as const,
  required: true,
  x: 10,
  y: 20,
  width: 80,
  height: 10,
  fontSize: 20,
  color: "#172b4d",
  align: "left" as const,
};
async function readText(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    return (await (await doc.getPage(1)).getTextContent()).items.filter(
      (item: any) => "str" in item,
    ) as any[];
  } finally {
    await task.destroy();
  }
}
test("custom certificate fields control data and PDF coordinates, work in batch, and preserve defaults", async () => {
  const app = await createApp({ logger: false });
  const image = await sharp({
    create: { width: 842, height: 595, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const payload = {
    template: "sertifikat",
    format: "pdf",
    background: `data:image/png;base64,${image.toString("base64")}`,
    certificateFields: [field],
    data: { instansi: "Universitas Contoh" },
  };
  try {
    const response = await app.inject({
      method: "POST",
      url: "/generate",
      payload,
    });
    expect(response.statusCode).toBe(200);
    const text = await readText(response.rawPayload);
    const item = text.find((item) => item.str === "Universitas Contoh");
    expect(item).toBeDefined();
    expect(item.transform[4]).toBeCloseTo(84.2, 1);
    expect(item.transform[5]).toBeCloseTo(456, 1);
    expect(text.some((item) => item.str.includes("Siti"))).toBe(false);
    const png = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { ...payload, format: "png" },
    });
    expect(png.statusCode).toBe(200);
    expect((await sharp(png.rawPayload).metadata()).format).toBe("png");
    const batch = await app.inject({
      method: "POST",
      url: "/generate/batch",
      payload: { ...payload, data: [payload.data] },
    });
    expect(batch.statusCode).toBe(200);
    expect(
      (await readText(unzipSync(batch.rawPayload)["0001-document.pdf"])).some(
        (item) => item.str === "Universitas Contoh",
      ),
    ).toBe(true);
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
          payload: { ...payload, template: "surat-resmi" },
        })
      ).statusCode,
    ).toBe(422);
    const template = (await app.inject("/templates/sertifikat")).json();
    expect(Object.keys(template.schema.fields)).toEqual([
      "nama",
      "kegiatan",
      "tanggal",
      "nomor",
    ]);
    const defaults = await app.inject({
      method: "POST",
      url: "/generate",
      payload: {
        template: "sertifikat",
        format: "pdf",
        data: template.sampleData,
      },
    });
    expect(defaults.statusCode).toBe(200);
    expect(
      (await readText(defaults.rawPayload)).some((item) =>
        item.str.includes("Siti"),
      ),
    ).toBe(true);
  } finally {
    await app.close();
  }
}, 30000);

test("certificate layout rejects duplicate keys, unsafe keys, bounds and invalid styles", () => {
  for (const fields of [
    [],
    [field, field],
    [{ ...field, key: "constructor" }],
    [{ ...field, x: 90 }],
    [{ ...field, height: 90 }],
    [{ ...field, fontSize: 1 }],
    [{ ...field, color: "red" }],
    Array.from({ length: 21 }, (_, i) => ({ ...field, key: `field${i}` })),
  ])
    expect(certificateFieldsSchema.safeParse(fields).success).toBe(false);
});
