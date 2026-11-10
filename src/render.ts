import {
  certificateFieldsSchema,
  type CertificateField,
} from "./certificate.js";
import {
  reportColumnsSchema,
  defaultReportColumns,
  type ReportColumn,
} from "./report.js";
import { chromium, type Browser } from "playwright";
import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import {
  Templates,
  type Template,
  validateData,
  ApiError,
} from "./templates.js";
export class Limiter {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(
    private max = 2,
    private maxWaiting = 100,
  ) {
    if (!Number.isInteger(max) || max < 1)
      throw new Error("Invalid concurrency");
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      if (this.waiting.length >= this.maxWaiting)
        throw new ApiError(503, "Antrean render penuh");
      await new Promise<void>((r) => this.waiting.push(r));
    } else this.active++;
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
export class Renderer {
  private browser?: Promise<Browser>;
  readonly limiter: Limiter;
  constructor(
    public templates = new Templates(),
    concurrency = 2,
  ) {
    this.limiter = new Limiter(concurrency);
  }
  async close() {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await (await browser).close();
  }
  async generate(
    id: string,
    format: "pdf" | "png",
    data: unknown,
    background?: string,
    columns?: ReportColumn[],
    certificateFields?: CertificateField[],
  ) {
    const t = await this.templates.load(id);
    if (columns && id !== "laporan")
      throw new ApiError(422, "Kolom khusus hanya untuk laporan");
    const reportColumns =
      id === "laporan"
        ? reportColumnsSchema.parse(columns ?? defaultReportColumns)
        : undefined;
    if (reportColumns) {
      t.schema = {
        ...t.schema,
        fields: {
          ...t.schema.fields,
          items: {
            type: "array",
            required: true,
            items: {
              fields: Object.fromEntries(
                reportColumns.map((c) => [
                  c.key,
                  { type: c.type, required: c.required },
                ]),
              ),
            },
          },
        },
      };
    }
    if (certificateFields) {
      if (id !== "sertifikat")
        throw new ApiError(422, "Field khusus hanya untuk sertifikat");
      certificateFields = certificateFieldsSchema.parse(certificateFields);
      t.schema = {
        fields: Object.fromEntries(
          certificateFields.map((f) => [
            f.key,
            { type: f.type, required: f.required },
          ]),
        ),
      };
    }
    const valid = validateData(t.schema, data);
    const renderData = reportColumns
      ? {
          ...valid,
          columns: reportColumns,
          rows: valid.items.map((row: Record<string, unknown>) =>
            reportColumns.map((c) => ({
              value:
                row[c.key] === undefined || row[c.key] === ""
                  ? "—"
                  : row[c.key],
            })),
          ),
        }
      : valid;
    if (background && id !== "sertifikat")
      throw new ApiError(422, "Background khusus hanya untuk sertifikat");
    return this.limiter.run(async () => {
      if (t.config.type === "overlay") {
        const { renderOverlay } = await import("./overlay.js");
        return renderOverlay(
          t,
          format,
          valid,
          this,
          background,
          certificateFields,
        );
      }
      return this.html(t, format, renderData);
    });
  }
  async html(t: Template, format: "pdf" | "png", data: unknown) {
    const source = await readFile(t.dir + "/template.html", "utf8");
    const html = Handlebars.compile(source, { strict: true })(data, {
      allowProtoMethodsByDefault: false,
      allowProtoPropertiesByDefault: false,
    });
    return this.renderHtml(html, t, format);
  }
  async renderHtml(html: string, t: Template, format: "pdf" | "png") {
    this.browser ??= chromium
      .launch({
        chromiumSandbox: process.env.CHROMIUM_NO_SANDBOX !== "1",
        args: process.env.CHROMIUM_NO_SANDBOX === "1" ? ["--no-sandbox"] : [],
      })
      .catch((e) => {
        this.browser = undefined;
        throw e;
      });
    const c = t.config;
    let w = c.size === "A5" ? 148 : c.size === "custom" ? c.width! : 210;
    let h = c.size === "A5" ? 210 : c.size === "custom" ? c.height! : 297;
    if (c.orientation === "landscape") [w, h] = [h, w];
    const context = await (
      await this.browser
    ).newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
      viewport: {
        width: Math.round((w * 96) / 25.4),
        height: Math.round((h * 96) / 25.4),
      },
      deviceScaleFactor: 1,
    });
    const deadline = setTimeout(() => {
      void context.close().catch(() => {});
    }, 30000);
    try {
      await context.route("**/*", async (route) => {
        const u = new URL(route.request().url());
        try {
          if (u.origin !== "https://docforge.local") return await route.abort();
          let body: Buffer;
          const p = decodeURIComponent(u.pathname);
          if (p.startsWith("/assets/"))
            body = await this.templates.local(t.dir + "/assets", p.slice(8));
          else if (p.startsWith("/fonts/"))
            body = await this.templates.local(this.templates.fonts, p.slice(7));
          else return await route.abort();
          const ext = p.split(".").pop();
          await route.fulfill({
            body,
            contentType:
              (
                {
                  png: "image/png",
                  jpg: "image/jpeg",
                  svg: "image/svg+xml",
                  woff2: "font/woff2",
                  ttf: "font/ttf",
                  css: "text/css",
                } as any
              )[ext!] ?? "application/octet-stream",
          });
        } catch {
          await route.abort();
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.setContent(
        `<base href="https://docforge.local/"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://docforge.local data:; style-src 'unsafe-inline' https://docforge.local; font-src https://docforge.local; script-src 'none'; frame-src 'none'">${html}${format === "png" ? `<style>body{box-sizing:border-box;margin:0;padding:${c.margin}mm;min-height:${h}mm;}</style>` : ""}`,
        { waitUntil: "networkidle", timeout: 15000 },
      );
      await page.evaluate(() => document.fonts.ready);
      await page.emulateMedia({ media: "print" });
      if (format === "pdf")
        return await page.pdf({
          width: `${w}mm`,
          height: `${h}mm`,
          margin: {
            top: `${c.margin}mm`,
            bottom: `${c.margin}mm`,
            left: `${c.margin}mm`,
            right: `${c.margin}mm`,
          },
          printBackground: true,
        });
      const pixels = await page.evaluate(
        () =>
          Math.max(document.documentElement.scrollWidth, innerWidth) *
          Math.max(document.documentElement.scrollHeight, innerHeight),
      );
      if (pixels > 60_000_000)
        throw new ApiError(
          422,
          "PNG terlalu besar; gunakan PDF atau kurangi konten",
        );
      return await page.screenshot({
        type: "png",
        fullPage: true,
        timeout: 15000,
      });
    } finally {
      clearTimeout(deadline);
      await context.close();
    }
  }
}
