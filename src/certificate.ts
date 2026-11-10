import { z } from "zod";
import { reportColumnsSchema } from "./report.js";
export const certificateFieldsSchema = z
  .array(
    reportColumnsSchema.element.extend({
      x: z.number().min(0).max(100),
      y: z.number().min(0).max(100),
      width: z.number().positive().max(100),
      height: z.number().positive().max(100),
      fontSize: z.number().min(6).max(100),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      align: z.enum(["left", "center", "right"]),
    }),
  )
  .min(1)
  .max(20)
  .superRefine((fields, ctx) => {
    if (new Set(fields.map((f) => f.key)).size !== fields.length)
      ctx.addIssue({ code: "custom", message: "Key field harus unik" });
    fields.forEach((f, i) => {
      if (f.x + f.width > 100.001 || f.y + f.height > 100.001)
        ctx.addIssue({
          code: "custom",
          path: [i],
          message: "Field melewati batas halaman",
        });
    });
  });
export type CertificateField = z.infer<typeof certificateFieldsSchema>[number];
export const defaultCertificateFields: CertificateField[] = [
  {
    key: "nama",
    label: "Nama",
    type: "string",
    required: true,
    x: 12,
    y: 43,
    width: 76,
    height: 12,
    fontSize: 32,
    color: "#264d66",
    align: "center",
  },
  {
    key: "kegiatan",
    label: "Kegiatan",
    type: "string",
    required: true,
    x: 15,
    y: 63,
    width: 70,
    height: 10,
    fontSize: 20,
    color: "#172b4d",
    align: "center",
  },
  {
    key: "tanggal",
    label: "Tanggal",
    type: "date",
    required: true,
    x: 30,
    y: 75,
    width: 40,
    height: 6,
    fontSize: 14,
    color: "#172b4d",
    align: "center",
  },
  {
    key: "nomor",
    label: "Nomor",
    type: "string",
    required: true,
    x: (45 / 842) * 100,
    y: (535 / 595) * 100,
    width: (300 / 842) * 100,
    height: (25 / 595) * 100,
    fontSize: 11,
    color: "#172b4d",
    align: "left",
  },
];
