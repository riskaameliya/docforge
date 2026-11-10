import { templateGuide } from "./template-guide.js";
// Shared by the browser converter and integration tests. No PDF execution is used.
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
const reserved = new Set(
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
    " ",
  ),
);
export function validIdentifier(name) {
  return (
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    !reserved.has(name) &&
    !["__proto__", "prototype", "constructor"].includes(name)
  );
}
const n = (value) => {
  if (!Number.isFinite(value))
    throw new Error("Ukuran atau posisi PDF tidak valid.");
  return Math.round(value * 1000) / 1000;
};
const literal = (value) =>
  value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
function textHtml(value) {
  return escapeHtml(value).replace(/{/g, "&#123;").replace(/}/g, "&#125;");
}
export function exportTemplate(
  pages,
  bindings,
  functionName = "TemplateDokumen",
) {
  if (!pages.length) throw new Error("Unggah PDF terlebih dahulu.");
  if (!validIdentifier(functionName))
    throw new Error(
      "Nama fungsi harus berupa identifier TypeScript, contoh TemplateSuratPemanggilan.",
    );
  const fields = new Map(),
    byId = new Map();
  for (const binding of bindings) {
    if (!validIdentifier(binding.key))
      throw new Error(
        `Nama variabel tidak valid: ${binding.key || "(kosong)"}. Gunakan contoh nomorSurat.`,
      );
    if (!["string", "number", "date"].includes(binding.type))
      throw new Error("Tipe field tidak didukung.");
    if (byId.has(binding.id))
      throw new Error("Teks dipetakan lebih dari sekali.");
    const sourceText = pages
      .flatMap((p) => p.texts)
      .find((t) => t.id === binding.id);
    if (!sourceText) throw new Error("Teks sumber tidak ditemukan.");
    if (
      binding.source !== undefined &&
      (!binding.source || !sourceText.text.includes(binding.source))
    )
      throw new Error(
        `Bagian teks untuk ${binding.key} tidak ditemukan pada teks asli.`,
      );
    if (binding.required && binding.type === "string" && !binding.sample.trim())
      throw new Error(`Contoh ${binding.key} wajib diisi.`);
    const previous = fields.get(binding.key);
    if (
      previous &&
      (previous.type !== binding.type ||
        previous.required !== binding.required ||
        previous.sample !== binding.sample)
    )
      throw new Error(
        `Variabel ${binding.key} digunakan lebih dari sekali. Samakan tipe, kewajiban, dan data contohnya.`,
      );
    if (
      binding.type === "number" &&
      (binding.sample === "" || !Number.isFinite(Number(binding.sample)))
    )
      throw new Error(`Contoh ${binding.key} harus berupa angka.`);
    if (
      binding.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(binding.sample) ||
        !Number.isFinite(Date.parse(binding.sample)) ||
        new Date(binding.sample).toISOString().slice(0, 10) !== binding.sample)
    )
      throw new Error(
        `Contoh ${binding.key} harus berupa tanggal YYYY-MM-DD yang valid.`,
      );
    fields.set(binding.key, binding);
    byId.set(binding.id, binding);
  }
  const schema = { fields: {} },
    sampleData = {};
  for (const [key, binding] of fields) {
    schema.fields[key] = { type: binding.type, required: binding.required };
    sampleData[key] =
      binding.type === "number" ? Number(binding.sample) : binding.sample;
  }
  const chunks = [];
  const push = (html) => chunks.push({ html });
  push(
    '<!doctype html>\n<html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' +
      escapeHtml(functionName) +
      "</title>\n<style>\n*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:#e8ebe5}.pdf-page{position:relative;background:#fff;overflow:hidden;margin:16px auto;break-after:page;page-break-after:always}.pdf-page:last-child{break-after:auto;page-break-after:auto}.pdf-background{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.pdf-text{position:absolute;white-space:pre;line-height:1;transform-origin:0 0;color:#111}.pdf-variable{white-space:pre-wrap;overflow-wrap:anywhere;overflow:hidden}@media print{body{background:#fff}.pdf-page{margin:0;box-shadow:none}}\n",
  );
  for (const [i, page] of pages.entries())
    push(
      `@page page${i + 1}{size:${n(page.width)}pt ${n(page.height)}pt;margin:0}\n`,
    );
  push("</style></head><body>\n");
  for (const [i, page] of pages.entries()) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(page.background))
      throw new Error("Latar PDF tidak valid.");
    push(
      `<section class="pdf-page" style="width:${n(page.width)}pt;height:${n(page.height)}pt;page:page${i + 1}" aria-label="Halaman ${i + 1}">\n<img class="pdf-background" src="${page.background}" alt="">\n`,
    );
    for (const text of page.texts) {
      const binding = byId.get(text.id),
        family = ["serif", "sans-serif", "monospace"].includes(text.family)
          ? text.family
          : "sans-serif";
      const width = binding?.width ?? text.width;
      const height = binding?.height ?? text.height * 1.4;
      if (width <= 0 || height <= 0)
        throw new Error("Ukuran area teks harus lebih besar dari nol.");
      push(
        `<span class="pdf-text${binding ? " pdf-variable" : ""}" style="left:${n(text.x)}pt;top:${n(text.y)}pt;font-size:${n(text.fontSize)}pt;font-family:${family};font-weight:${text.bold ? "700" : "400"};font-style:${text.italic ? "italic" : "normal"};transform:rotate(${n(text.angle ?? 0)}deg);${binding ? `width:${n(width)}pt;height:${n(height)}pt;` : ""}">`,
      );
      if (binding) {
        const source = binding.source ?? text.text;
        const start = text.text.indexOf(source);
        push(textHtml(text.text.slice(0, start)));
        chunks.push({ key: binding.key });
        push(textHtml(text.text.slice(start + source.length)));
      } else push(textHtml(text.text));
      push("</span>\n");
    }
    push("</section>\n");
  }
  push("</body></html>");
  const html = chunks
    .map((c) => (c.key !== undefined ? `{{${c.key}}}` : c.html))
    .join("");
  const preview = chunks
    .map((c) => (c.key !== undefined ? escapeHtml(sampleData[c.key]) : c.html))
    .join("");
  const typeName = functionName + "Data";
  const properties = [...fields]
    .map(
      ([key, b]) =>
        `  ${JSON.stringify(key)}${b.required ? "" : "?"}: ${b.type === "number" ? "number" : "string"};`,
    )
    .join("\n");
  const body = chunks
    .map((c) =>
      c.key !== undefined
        ? "${escapeHtml(data[" + JSON.stringify(c.key) + "])}"
        : literal(c.html),
    )
    .join("");
  const typescript = `/**\n * Generated by DocForge from a PDF.\n * Fixed page layout; review fonts/positions before use.\n * Repeating tables and application logic must be added manually.\n */\nexport type ${typeName} = ${fields.size ? "{\n" + properties + "\n}" : "Record<string, never>"};\n\nexport const ${functionName} = (data: ${typeName}): string => {\n  const escapeHtml = (value: unknown): string =>\n    (value == null ? "" : \`\${value}\`).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[char] ?? char);\n\n  return \`${body}\`;\n};\n`;
  const config = {
    type: "html",
    size: "custom",
    width: n((pages[0].width * 25.4) / 72),
    height: n((pages[0].height * 25.4) / 72),
    margin: 0,
    orientation: "portrait",
  };
  const { usage, readme } = templateGuide(functionName, sampleData);
  return {
    html,
    preview,
    typescript,
    schema,
    sampleData,
    config,
    usage,
    readme,
  };
}
