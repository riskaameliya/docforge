import { expect, test } from "vitest";
import { validateData } from "../src/templates.js";
const schema = {
  fields: {
    nama: { type: "string", required: true },
    tanggal: { type: "date", required: true },
    nilai: { type: "number" },
    items: {
      type: "array",
      items: { fields: { jumlah: { type: "number", required: true } } },
    },
  },
};
test("validates Unicode, optional fields and nested arrays", () => {
  expect(
    validateData(schema, { nama: "Dr. Éka, S.T.", tanggal: "2026-11-09" }).nama,
  ).toContain("Éka");
  expect(() =>
    validateData(schema, {
      nama: "",
      tanggal: "2026-02-30",
      items: [{ jumlah: "x" }],
    }),
  ).toThrow();
});
test("reports field paths", () => {
  try {
    validateData(schema, {
      nama: "A",
      tanggal: "2026-01-01",
      items: [{ jumlah: "x" }],
    });
  } catch (e: any) {
    expect(e.statusCode).toBe(422);
    expect(e.fields[0].field).toBe("items.0.jumlah");
  }
});
