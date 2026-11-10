import { expect, test } from "vitest";
import { createApp } from "../src/app.js";
import { reportColumnsSchema } from "../src/report.js";
import { unzipSync } from "fflate";

async function textFromPdf(bytes: Uint8Array) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true,
  });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    return (await page.getTextContent()).items
      .map((item: any) => item.str ?? "")
      .join(" ");
  } finally {
    await task.destroy();
  }
}

test("custom report columns render in order, preserve zero, escape HTML, support batch and leave defaults intact", async () => {
  const app = await createApp({ logger: false });
  const columns = [
    {
      key: "harga",
      label: "Harga <b>satuan</b>",
      type: "number",
      required: true,
    },
    { key: "produk", label: "Produk", type: "string", required: true },
  ];
  const data = {
    judul: "Laporan custom",
    tanggal: "2026-11-09",
    items: [{ harga: 0, produk: "Pensil <script>" }],
  };
  try {
    const response = await app.inject({
      method: "POST",
      url: "/generate",
      payload: { template: "laporan", format: "pdf", columns, data },
    });
    expect(response.statusCode).toBe(200);
    const text = await textFromPdf(response.rawPayload);
    expect(text).toContain("Harga <b>satuan</b>");
    expect(text).toContain("Pensil <script>");
    expect(text).toContain("0");
    expect(text.indexOf("Harga")).toBeLessThan(text.indexOf("Produk"));
    const invalid = await app.inject({
      method: "POST",
      url: "/generate",
      payload: {
        template: "laporan",
        format: "pdf",
        columns,
        data: { ...data, items: [{ harga: "abc", produk: "Pensil" }] },
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.fields[0].field).toBe("items.0.harga");
    const batch = await app.inject({
      method: "POST",
      url: "/generate/batch",
      payload: { template: "laporan", format: "pdf", columns, data: [data] },
    });
    expect(batch.statusCode).toBe(200);
    expect(
      await textFromPdf(unzipSync(batch.rawPayload)["0001-document.pdf"]),
    ).toContain("Harga <b>satuan</b>");
    const defaults = await app.inject({
      method: "POST",
      url: "/generate",
      payload: {
        template: "laporan",
        format: "pdf",
        data: { ...data, items: [{ nama: "Buku", jumlah: 1 }] },
      },
    });
    expect(defaults.statusCode).toBe(200);
    const defaultText = await textFromPdf(defaults.rawPayload);
    expect(defaultText).toContain("Keterangan");
    expect(defaultText).not.toContain("Harga");
  } finally {
    await app.close();
  }
}, 30000);

test("report column validation rejects empty, duplicate, reserved and excessive keys", () => {
  const column = { key: "nama", label: "Nama", type: "string" };
  for (const columns of [
    [],
    [column, column],
    [{ ...column, key: "constructor" }],
    [{ ...column, label: " " }],
    Array.from({ length: 13 }, (_, i) => ({ ...column, key: `key${i}` })),
  ]) {
    expect(reportColumnsSchema.safeParse(columns).success).toBe(false);
  }
});
