const $ = (id) => document.getElementById(id);
const metadata = {
  sertifikat: {
    title: "Sertifikat",
    description: "Apresiasi yang berkesan",
    badge: "OVERLAY · LANDSCAPE",
    icon: "✧",
    style: "",
  },
  "surat-resmi": {
    title: "Surat resmi",
    description: "Korespondensi profesional",
    badge: "HTML · A4",
    icon: "▤",
    style: "letter",
  },
  laporan: {
    title: "Laporan",
    description: "Data tersusun, mudah dibaca",
    badge: "HTML · TABEL",
    icon: "▥",
    style: "report",
  },
};
let selected = null,
  mode = "single",
  busy = false,
  outputUrl = null,
  selectionVersion = 0;
let connected = false,
  fieldReaders = new Map();
const emptyPreview = $("preview-body").innerHTML;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function pretty(name) {
  return name.replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase());
}
function showNotice(message, success = false) {
  $("notice").textContent = message;
  $("notice").classList.toggle("success", success);
  $("notice").hidden = !message;
}
function setConnection(value) {
  connected = value;
  $("connection-pill").classList.toggle("connected", value);
  $("connection-pill").replaceChildren(
    element("i"),
    document.createTextNode(value ? "Terhubung" : "Belum terhubung"),
  );
  $("connection-label").textContent = value
    ? "Terhubung · Siap digunakan"
    : "Belum terhubung";
}
function resetOutput() {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  $("preview-body").innerHTML = emptyPreview;
  $("preview-tag").textContent = "BELUM ADA HASIL";
  $("preview-download").hidden = true;
  $("download-link").removeAttribute("href");
}
function setBusy(value) {
  busy = value;
  $("generate-button").disabled = value || !selected || !connected;
  $("sample-button").disabled = value || !selected;
  $("upload-button").disabled = value || !selected;
  document
    .querySelectorAll(
      ".template-card, #mode-single, #mode-batch, #nav-single, #nav-batch, #connection-button, #connection-pill",
    )
    .forEach((b) => (b.disabled = value));
  $("generate-button").replaceChildren(
    element("span", value ? "spinner" : "", value ? "" : "✦"),
    document.createTextNode(
      value
        ? "Sedang memproses…"
        : mode === "batch"
          ? "Buat semua dokumen"
          : "Buat dokumen",
    ),
    element("span", "", value ? "" : "→"),
  );
}
async function request(url, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...options.headers,
  };
  const response = await fetch(url, {
    ...options,
    headers,
    signal:
      options.signal ||
      AbortSignal.timeout(url === "/generate/batch" ? 180000 : 40000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(
      body.error?.message || `Permintaan gagal (${response.status}).`,
    );
    error.fields = body.error?.fields;
    error.status = response.status;
    throw error;
  }
  return response;
}
async function loadTemplates() {
  const templates = await (await request("/templates")).json();
  const order = Object.keys(metadata);
  templates.sort(
    (a, b) =>
      (order.indexOf(a.id) < 0 ? order.length : order.indexOf(a.id)) -
      (order.indexOf(b.id) < 0 ? order.length : order.indexOf(b.id)),
  );
  $("template-grid").replaceChildren();
  $("template-count").textContent = `${templates.length} template tersedia`;
  for (const template of templates) {
    const info = metadata[template.id] || {
      title: pretty(template.id),
      description: "Template dokumen",
      badge: template.type.toUpperCase(),
      icon: "▤",
      style: "letter",
    };
    const card = element("button", "template-card");
    card.type = "button";
    card.dataset.template = template.id;
    card.setAttribute("aria-pressed", "false");
    const mini = element("div", `template-mini ${info.style}`);
    mini.setAttribute("aria-hidden", "true");
    mini.append(
      element("span", "", info.icon),
      element("i"),
      element("i"),
      element("i"),
    );
    const copy = element("div");
    copy.append(
      element("strong", "", info.title),
      element("p", "", info.description),
      element("small", "", info.badge),
    );
    card.append(mini, copy, element("span", "selection-dot"));
    card.addEventListener("click", () =>
      selectTemplate(template.id).catch(handleError),
    );
    $("template-grid").append(card);
  }
  if (templates.length)
    await selectTemplate(
      templates.find((t) => t.id === selected?.id)?.id || templates[0].id,
    );
  else {
    selected = null;
    setBusy(false);
    $("template-grid").append(
      element(
        "div",
        "template-placeholder",
        "Belum ada template. Hubungi pengelola untuk menambahkan template.",
      ),
    );
  }
}
async function selectTemplate(id) {
  const version = ++selectionVersion;
  const template = await (
    await request(`/templates/${encodeURIComponent(id)}`)
  ).json();
  if (version !== selectionVersion) return;
  selected = template;
  resetOutput();
  showNotice("");
  document.querySelectorAll(".template-card").forEach((card) => {
    const active = card.dataset.template === id;
    card.classList.toggle("selected", active);
    card.setAttribute("aria-pressed", String(active));
  });
  $("data-description").textContent =
    `Isi data untuk ${metadata[id]?.title.toLowerCase() || pretty(id).toLowerCase()}. Kolom bertanda * wajib diisi.`;
  populate(template.sampleData);
  setBusy(false);
}
function makeScalar(name, definition, value, path, label = true) {
  const wrapper = element("div", "field");
  const id = `field-${path.replace(/[^a-z0-9_-]/gi, "-")}`;
  const multiline =
    ["isi", "keterangan", "alamat", "catatan", "deskripsi"].includes(name) ||
    (typeof value === "string" && value.length > 140);
  if (multiline) wrapper.classList.add("full");
  if (label) {
    const title = element("label", "", pretty(name));
    title.htmlFor = id;
    title.append(
      element(
        "span",
        definition.required ? "required" : "optional",
        definition.required ? "*" : "opsional",
      ),
    );
    wrapper.append(title);
  }
  const input = element(multiline ? "textarea" : "input");
  input.id = id;
  input.dataset.path = path;
  input.setAttribute("aria-label", pretty(name));
  if (!multiline)
    input.type =
      definition.type === "date"
        ? "date"
        : definition.type === "number"
          ? "number"
          : "text";
  if (definition.type === "number") input.step = "any";
  input.value = value ?? "";
  input.placeholder = `Masukkan ${pretty(name).toLowerCase()}`;
  input.required = !!definition.required;
  wrapper.append(input);
  const read = () => {
    const v = input.value;
    return v === "" && !definition.required
      ? undefined
      : definition.type === "number"
        ? v === ""
          ? undefined
          : Number(v)
        : v;
  };
  return { wrapper, input, read };
}
function makeArray(name, definition, values = []) {
  const wrapper = element("div", "field full");
  const label = element("label", "", pretty(name));
  label.append(
    element(
      "span",
      definition.required ? "required" : "optional",
      definition.required ? "*" : "opsional",
    ),
  );
  wrapper.append(label);
  if (!definition.items?.fields) {
    const input = element("textarea");
    input.id = `field-${name}`;
    input.dataset.path = name;
    input.setAttribute("aria-label", pretty(name));
    input.value = JSON.stringify(values, null, 2);
    input.spellcheck = false;
    wrapper.append(input);
    return {
      wrapper,
      read: () => {
        try {
          const value = JSON.parse(input.value || "[]");
          if (!Array.isArray(value)) throw new Error();
          return value;
        } catch {
          const error = new Error(
            `${pretty(name)} harus berisi array JSON yang valid.`,
          );
          error.fields = [{ field: name, message: error.message }];
          throw error;
        }
      },
    };
  }
  const columns = Object.entries(definition.items.fields);
  const tableWrap = element("div", "table-wrapper"),
    table = element("table", "data-table"),
    head = element("thead"),
    headRow = element("tr"),
    body = element("tbody");
  for (const [key, def] of columns)
    headRow.append(element("th", "", pretty(key) + (def.required ? " *" : "")));
  headRow.append(element("th", "", ""));
  head.append(headRow);
  table.append(head, body);
  tableWrap.append(table);
  wrapper.append(tableWrap);
  const rowReaders = [];
  const footer = element("div", "table-footer"),
    count = element("span"),
    add = element("button", "subtle-button", "+ Tambah baris");
  add.type = "button";
  footer.append(count, add);
  wrapper.append(footer);
  function renumber() {
    count.textContent = `${rowReaders.length} baris`;
    rowReaders.forEach((row, index) => {
      for (const [key, control] of row.controls) {
        control.input.dataset.path = `${name}.${index}.${key}`;
        control.input.setAttribute(
          "aria-label",
          `${pretty(key)} baris ${index + 1}`,
        );
      }
    });
  }
  function addRow(value = {}) {
    const tr = element("tr"),
      controls = new Map();
    for (const [key, def] of columns) {
      const td = element("td");
      if (def.type === "array") {
        const input = element("input");
        input.value = JSON.stringify(value[key] ?? []);
        input.setAttribute("aria-label", pretty(key));
        controls.set(key, {
          input,
          read: () => JSON.parse(input.value || "[]"),
        });
        td.append(input);
      } else {
        const control = makeScalar(
          key,
          def,
          value[key],
          `${name}.${rowReaders.length}.${key}`,
          false,
        );
        controls.set(key, control);
        td.append(control.input);
      }
      tr.append(td);
    }
    const td = element("td"),
      remove = element("button", "", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "Hapus baris");
    td.append(remove);
    tr.append(td);
    const row = { tr, controls };
    rowReaders.push(row);
    body.append(tr);
    remove.onclick = () => {
      rowReaders.splice(rowReaders.indexOf(row), 1);
      tr.remove();
      renumber();
    };
    renumber();
  }
  add.onclick = () => addRow();
  for (const row of values) addRow(row);
  renumber();
  return {
    wrapper,
    read: () =>
      rowReaders.map((row) =>
        Object.fromEntries(
          [...row.controls].map(([key, control]) => [key, control.read()]),
        ),
      ),
  };
}
function populate(data) {
  $("dynamic-fields").replaceChildren();
  fieldReaders = new Map();
  for (const [name, definition] of Object.entries(selected.schema.fields)) {
    const control =
      definition.type === "array"
        ? makeArray(name, definition, data[name] ?? [])
        : makeScalar(name, definition, data[name], name);
    fieldReaders.set(name, control.read);
    $("dynamic-fields").append(control.wrapper);
  }
  $("batch-data").value = JSON.stringify([data], null, 2);
  const filename = $("filename-field");
  filename.replaceChildren(element("option", "", "Nomor urut"));
  filename.options[0].value = "";
  for (const [name, def] of Object.entries(selected.schema.fields))
    if (def.type !== "array") {
      const option = element("option", "", pretty(name));
      option.value = name;
      filename.append(option);
    }
  filename.value = selected.schema.fields.nama
    ? "nama"
    : selected.schema.fields.nomor
      ? "nomor"
      : "";
  updateBatchCount();
  clearErrors();
}
function setMode(value) {
  if (busy) return;
  mode = value;
  $("document-form").noValidate = mode === "batch";
  resetOutput();
  showNotice("");
  $("dynamic-fields").hidden = mode === "batch";
  $("batch-fields").hidden = mode !== "batch";
  for (const id of ["mode-single", "nav-single"])
    $(id).classList.toggle(
      id.startsWith("nav") ? "active" : "selected",
      mode === "single",
    );
  for (const id of ["mode-batch", "nav-batch"])
    $(id).classList.toggle(
      id.startsWith("nav") ? "active" : "selected",
      mode === "batch",
    );
  $("breadcrumb-page").textContent =
    mode === "batch" ? "Buat sekaligus" : "Buat dokumen";
  setBusy(false);
}
function clearErrors() {
  document.querySelectorAll(".field-error").forEach((e) => e.remove());
  document
    .querySelectorAll(".has-error")
    .forEach((e) => e.classList.remove("has-error"));
  document
    .querySelectorAll("[aria-invalid]")
    .forEach((e) => e.removeAttribute("aria-invalid"));
}
function handleError(error) {
  if (error.name === "AbortError" || error.name === "TimeoutError")
    showNotice("Permintaan terlalu lama. Coba lagi atau kurangi jumlah data.");
  else if (error instanceof TypeError)
    showNotice("Server belum dapat dihubungi. Periksa koneksi dan coba lagi.");
  else showNotice(error.message);
  for (const issue of error.fields || []) {
    const input = [...document.querySelectorAll("[data-path]")].find(
      (e) => e.dataset.path === issue.field,
    );
    if (input) {
      input.setAttribute("aria-invalid", "true");
      const parent = input.closest("td") || input.closest(".field");
      parent?.classList.add("has-error");
      parent?.append(element("small", "field-error", issue.message));
    }
  }
}
function updateBatchCount() {
  try {
    const value = JSON.parse($("batch-data").value);
    $("batch-count").textContent = Array.isArray(value)
      ? `${value.length} dokumen`
      : "Harus berupa array JSON";
  } catch {
    $("batch-count").textContent = "JSON belum valid";
  }
}
function showOutput(blob, format) {
  resetOutput();
  outputUrl = URL.createObjectURL(blob);
  const node = element(format === "pdf" ? "iframe" : "img");
  if (format === "pdf") {
    node.title = "Pratinjau dokumen PDF";
    node.src = outputUrl + "#toolbar=0";
  } else {
    node.alt = "Pratinjau dokumen yang dibuat";
    node.src = outputUrl;
  }
  $("preview-body").replaceChildren(node);
  $("preview-tag").textContent = `${format.toUpperCase()} · SIAP`;
  const name = `${selected.id}.${format}`;
  $("output-filename").textContent = name;
  $("output-size").textContent =
    `${(blob.size / 1024).toFixed(1)} KB · Dokumen siap diunduh`;
  $("download-link").href = outputUrl;
  $("download-link").download = name;
  $("preview-download").hidden = false;
  showNotice(
    "Dokumen berhasil dibuat. Periksa pratinjau, lalu unduh hasilnya.",
    true,
  );
}
$("document-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !selected) return;
  clearErrors();
  showNotice("");
  const format = document.querySelector('input[name="format"]:checked').value;
  try {
    setBusy(true);
    resetOutput();
    if (mode === "batch") {
      let data;
      try {
        data = JSON.parse($("batch-data").value);
      } catch {
        throw new Error("Data batch belum berupa JSON yang valid.");
      }
      if (!Array.isArray(data) || data.length === 0)
        throw new Error("Isi minimal satu dokumen dalam array JSON.");
      const body = {
        template: selected.id,
        format,
        data,
        filenameField: $("filename-field").value || undefined,
      };
      const response = await request("/generate/batch", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const blob = await response.blob();
      outputUrl = URL.createObjectURL(blob);
      $("download-link").href = outputUrl;
      $("download-link").download = "batch.zip";
      $("output-filename").textContent = "batch.zip";
      $("output-size").textContent =
        `${(blob.size / 1024).toFixed(1)} KB · Dokumen dan report.json`;
      $("preview-tag").textContent = "ZIP · SIAP";
      $("preview-download").hidden = false;
      showNotice(
        "Batch selesai. Unduh ZIP dan periksa report.json untuk rincian hasil.",
        true,
      );
      setBusy(false);
    } else {
      const data = Object.fromEntries(
        [...fieldReaders].map(([name, read]) => [name, read()]),
      );
      const response = await request("/generate", {
        method: "POST",
        body: JSON.stringify({ template: selected.id, format, data }),
      });
      showOutput(await response.blob(), format);
      setBusy(false);
    }
  } catch (error) {
    handleError(error);
    setBusy(false);
  }
});
async function connect() {
  try {
    await loadTemplates();
    setConnection(true);
    showNotice("");
  } catch (error) {
    setConnection(false);
    handleError(error);
  }
  setBusy(false);
}
$("connection-button").onclick = connect;
$("connection-pill").onclick = connect;
$("nav-single").onclick = $("mode-single").onclick = () => setMode("single");
$("nav-batch").onclick = $("mode-batch").onclick = () => setMode("batch");
$("sample-button").onclick = () => {
  if (selected) {
    populate(selected.sampleData);
    resetOutput();
    showNotice(
      "Data contoh dimuat. Kamu bisa mengubahnya sebelum membuat dokumen.",
      true,
    );
  }
};
$("batch-data").addEventListener("input", updateBatchCount);
$("upload-button").onclick = () => $("json-file").click();
$("json-file").addEventListener("change", async () => {
  const file = $("json-file").files[0];
  if (!file || !selected) return;
  try {
    if (file.size > 1048576)
      throw new Error("File terlalu besar. Pilih file JSON maksimal 1 MB.");
    const value = JSON.parse(await file.text());
    if (Array.isArray(value)) {
      if (!value.every((v) => v && typeof v === "object" && !Array.isArray(v)))
        throw new Error("Setiap item harus berupa objek data.");
      setMode("batch");
      $("batch-data").value = JSON.stringify(value, null, 2);
      updateBatchCount();
    } else if (value && typeof value === "object") {
      setMode("single");
      populate(value);
    } else
      throw new Error(
        "Gunakan objek JSON untuk satu dokumen atau array objek untuk batch.",
      );
    resetOutput();
    showNotice(`Data dari ${file.name} berhasil diimpor.`, true);
  } catch (error) {
    handleError(
      error instanceof SyntaxError
        ? new Error("File tidak berisi JSON yang valid.")
        : error,
    );
  } finally {
    $("json-file").value = "";
  }
});
window.addEventListener("beforeunload", () => {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
});
// Remove credentials retained by older versions of the application.
try {
  sessionStorage.removeItem("docforge-key");
} catch {}
connect();
