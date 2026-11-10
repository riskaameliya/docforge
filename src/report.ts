import { z } from "zod";
export const reportColumnsSchema = z
  .array(
    z.object({
      key: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/)
        .refine(
          (key) => !["constructor", "prototype", "__proto__"].includes(key),
          "Nama kolom tidak valid",
        ),
      label: z.string().trim().min(1).max(80),
      type: z.enum(["string", "number", "date"]),
      required: z.boolean().default(false),
    }),
  )
  .min(1)
  .max(12)
  .refine(
    (columns) => new Set(columns.map((c) => c.key)).size === columns.length,
    "Nama key kolom harus unik",
  );
export type ReportColumn = z.infer<typeof reportColumnsSchema>[number];
export const defaultReportColumns: ReportColumn[] = [
  { key: "nama", label: "Nama", type: "string", required: true },
  { key: "jumlah", label: "Jumlah", type: "number", required: true },
  { key: "keterangan", label: "Keterangan", type: "string", required: false },
];
