import { certificateFieldsSchema } from "./certificate.js";
import { reportColumnsSchema } from "./report.js";
import { zipSync } from "fflate";
import { z } from "zod";
import { ApiError } from "./templates.js";
import type { Renderer } from "./render.js";
export const backgroundSchema = z
  .string()
  .max(7 * 1024 * 1024)
  .regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/)
  .optional();
export const batchSchema = (limit: number) =>
  z.object({
    template: z.string().regex(/^[\w-]+$/),
    format: z.enum(["pdf", "png"]),
    data: z.array(z.record(z.string(), z.unknown())).min(1).max(limit),
    background: backgroundSchema,
    columns: reportColumnsSchema.optional(),
    certificateFields: certificateFieldsSchema.optional(),
    filenameField: z.string().max(100).optional(),
  });
export type BatchInput = z.infer<ReturnType<typeof batchSchema>>;
export type BatchResult = {
  total: number;
  succeeded: number;
  failures: Array<{ index: number; message: string; fields?: unknown }>;
};
export function safeFilename(value: unknown, index: number, format: string) {
  const name =
    String(value ?? "document")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "_")
      .slice(0, 80) || "document";
  return `${String(index + 1).padStart(4, "0")}-${name}.${format}`;
}
export async function processBatch(
  input: BatchInput,
  renderer: Renderer,
): Promise<Buffer> {
  await renderer.templates.load(input.template);
  if (input.background && input.template !== "sertifikat")
    throw new ApiError(422, "Background khusus hanya untuk sertifikat");
  if (input.columns && input.template !== "laporan")
    throw new ApiError(422, "Kolom khusus hanya untuk laporan");
  if (input.certificateFields && input.template !== "sertifikat")
    throw new ApiError(422, "Field khusus hanya untuk sertifikat");
  const files: Record<string, Uint8Array> = {};
  const result: BatchResult = {
    total: input.data.length,
    succeeded: 0,
    failures: [],
  };
  let size = 0;
  const deadline = Date.now() + 120000;
  for (const [index, data] of input.data.entries()) {
    if (Date.now() > deadline)
      throw new ApiError(503, "Batch terlalu lama. Kurangi jumlah dokumen.");
    let bytes: Uint8Array;
    try {
      bytes = await renderer.generate(
        input.template,
        input.format,
        data,
        input.background,
        input.columns,
        input.certificateFields,
      );
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 422) throw error;
      result.failures.push({
        index,
        message: error.message,
        fields: error.fields,
      });
      continue;
    }
    size += bytes.byteLength;
    if (size > 64 * 1024 * 1024)
      throw new ApiError(
        413,
        "Hasil batch melebihi 64 MB. Kurangi jumlah dokumen.",
      );
    files[
      safeFilename(
        input.filenameField ? data[input.filenameField] : undefined,
        index,
        input.format,
      )
    ] = bytes;
    result.succeeded++;
  }
  files["report.json"] = Buffer.from(JSON.stringify(result, null, 2));
  return Buffer.from(zipSync(files, { level: 0 }));
}
