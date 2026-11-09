import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public fields?: unknown,
  ) {
    super(message);
  }
}
const field: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.enum(["string", "number", "date", "array"]),
    required: z.boolean().default(false),
    items: z
      .union([field, z.object({ fields: z.record(z.string(), field) })])
      .optional(),
  }),
);
export const schemaDefinition = z.object({
  fields: z.record(z.string(), field),
});
export function dataValidator(def: unknown): z.ZodType<any> {
  const build = (fields: Record<string, any>): z.ZodType<any> =>
    z.object(
      Object.fromEntries(
        Object.entries(fields).map(([key, f]) => {
          let s: z.ZodType<any> =
            f.type === "number"
              ? z.number()
              : f.type === "date"
                ? z.iso.date()
                : f.type === "array"
                  ? z.array(
                      f.items?.fields
                        ? build(f.items.fields)
                        : f.items
                          ? value(f.items)
                          : z.unknown(),
                    )
                  : z.string();
          function value(v: any): z.ZodType<any> {
            return v.type === "number"
              ? z.number()
              : v.type === "date"
                ? z.iso.date()
                : v.type === "array"
                  ? z.array(v.items ? value(v.items) : z.unknown())
                  : z.string();
          }
          if (f.required && f.type === "string")
            s = z.string().min(1, "Field wajib diisi");
          return [key, f.required ? s : s.optional()];
        }),
      ),
    );
  return build(schemaDefinition.parse(def).fields);
}
export function validateData(schema: unknown, data: unknown) {
  const r = dataValidator(schema).safeParse(data);
  if (!r.success)
    throw new ApiError(
      422,
      "Data tidak sesuai schema",
      r.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    );
  return r.data;
}
export const configSchema = z
  .object({
    type: z.enum(["html", "overlay"]).default("html"),
    size: z.enum(["A4", "A5", "custom"]).default("A4"),
    width: z.number().positive().max(3000).optional(),
    height: z.number().positive().max(3000).optional(),
    orientation: z.enum(["portrait", "landscape"]).default("portrait"),
    margin: z.number().min(0).max(200).default(15),
    background: z.string().optional(),
  })
  .refine(
    (c) => c.size !== "custom" || (!!c.width && !!c.height),
    "Custom size requires width and height in mm",
  );
export class Templates {
  constructor(
    public root = path.resolve("templates"),
    public fonts = path.resolve("fonts"),
  ) {}
  async load(id: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id))
      throw new ApiError(404, "Template tidak ditemukan");
    const dir = path.join(this.root, id);
    try {
      const schema = JSON.parse(
        await readFile(path.join(dir, "schema.json"), "utf8"),
      );
      schemaDefinition.parse(schema);
      const sample = JSON.parse(
        await readFile(path.join(dir, "sample-data.json"), "utf8"),
      );
      const config = configSchema.parse(
        JSON.parse(
          await readFile(path.join(dir, "config.json"), "utf8").catch((e) => {
            if (e.code === "ENOENT") return "{}";
            throw e;
          }),
        ),
      );
      return { id, dir, schema, sample, config };
    } catch (e: any) {
      if (e.code === "ENOENT")
        throw new ApiError(404, "Template tidak ditemukan");
      throw e;
    }
  }
  async list() {
    const dirs = await readdir(this.root, { withFileTypes: true });
    return Promise.all(
      dirs
        .filter((d) => d.isDirectory())
        .map(async (d) => {
          const t = await this.load(d.name);
          return { id: t.id, type: t.config.type };
        }),
    );
  }
  async local(root: string, file: string) {
    const base = await realpath(root);
    const target = await realpath(path.resolve(base, file));
    if (!target.startsWith(base + path.sep))
      throw new ApiError(403, "Asset di luar folder");
    return readFile(target);
  }
}
export type Template = Awaited<ReturnType<Templates["load"]>>;
