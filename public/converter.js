import * as pdfjs from "/editor-vendor/pdf.mjs";
import { zipSync } from "/converter-vendor/fflate.js";
import { exportTemplate, validIdentifier } from "/template-export.js";
pdfjs.GlobalWorkerOptions.workerSrc = "/editor-vendor/pdf.worker.mjs";
const $ = (id) => document.getElementById(id);
let pages = [],
  bindings = [],
  current = 0,
  activeId = null,
  output = null,
  tab = "preview",
  processing = false;
function node(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}
function status(message, success = false) {
  $("converter-status").textContent = message;
  $("converter-status").classList.toggle("success", success);
}
function updateExports() {
  try {
    output = pages.length
      ? exportTemplate(pages, bindings, $("function-name").value.trim())
      : null;
    $("download-ts").disabled = !output || processing;
    $("download-package").disabled = !output || processing;
    if (output) {
      $("html-preview").srcdoc = output.preview;
      if (!processing)
        status(
          `${pages.length} halaman dibaca · ${pages.reduce((n, p) => n + p.texts.length, 0)} potongan teks · ${new Set(bindings.map((b) => b.key)).size} variabel. Pilih teks untuk menggantinya dengan data.`,
          true,
        );
    }
    showTab(tab);
  } catch (error) {
    output = null;
    $("download-ts").disabled = true;
    $("download-package").disabled = true;
    status(error.message);
    $("code-output").value = "Perbaiki pemetaan untuk mengekspor kode.";
    $("html-preview").removeAttribute("srcdoc");
  }
}
function showTab(value) {
  tab = value;
  document
    .querySelectorAll("[data-tab]")
    .forEach((e) =>
      e.setAttribute("aria-selected", String(e.dataset.tab === tab)),
    );
  $("export-empty").hidden = !!pages.length;
  $("html-preview").hidden = !output || tab !== "preview";
  $("code-output").hidden = !pages.length || tab === "preview";
  $("copy-code").hidden = !output || tab === "preview";
  if (!output) {
    $("code-output").value =
      "Unggah PDF dan isi pemetaan yang valid untuk melihat kode.";
    return;
  }
  $("code-output").value =
    tab === "typescript"
      ? output.typescript
      : tab === "html"
        ? output.html
        : tab === "usage"
          ? output.usage
          : JSON.stringify(
              {
                schema: output.schema,
                sampleData: output.sampleData,
                config: output.config,
              },
              null,
              2,
            );
}
function showPage() {
  const p = pages[current];
  $("pdf-stage").replaceChildren();
  if (!p) return;
  const image = node("img");
  image.src = p.original;
  image.alt = `PDF asli, halaman ${current + 1}`;
  $("pdf-stage").append(image);
  for (const text of p.texts) {
    if (!text.text.trim()) continue;
    const bound = bindings.some((b) => b.id === text.id);
    const hit = node(
      "button",
      `text-hit${bound ? " mapped" : ""}${activeId === text.id ? " selected" : ""}`,
    );
    hit.type = "button";
    hit.dataset.textId = text.id;
    hit.title = text.text;
    hit.setAttribute("aria-label", `Jadikan variabel: ${text.text}`);
    hit.style.cssText = `left:${(text.x / p.width) * 100}%;top:${(text.y / p.height) * 100}%;width:${(Math.max(text.width, 3) / p.width) * 100}%;height:${((text.height * 1.3) / p.height) * 100}%;transform:rotate(${text.angle}deg);transform-origin:0 0;`;
    hit.onclick = () => selectText(text);
    $("pdf-stage").append(hit);
  }
  $("page-label").textContent = `${current + 1} / ${pages.length}`;
  $("previous-page").disabled = current === 0 || processing;
  $("next-page").disabled = current === pages.length - 1 || processing;
  $("source-details").textContent = p.texts.some((t) => t.text.trim())
    ? `${p.texts.filter((t) => t.text.trim()).length} potongan teks · klik untuk dijadikan variabel.`
    : "Tidak ada teks terdeteksi. PDF scan dapat diekspor statis atau diisi dengan editor overlay.";
}
function selectText(text) {
  activeId = text.id;
  if (!bindings.some((b) => b.id === text.id)) {
    let number = bindings.length + 1;
    while (bindings.some((b) => b.key === `field${number}`)) number++;
    bindings.push({
      id: text.id,
      key: `field${number}`,
      type: "string",
      required: true,
      sample: text.text,
      source: text.text,
      width:
        Math.round(
          Math.min(Math.max(text.width, 80), pages[current].width - text.x) *
            100,
        ) / 100,
      height: Math.min(
        Math.max(text.height * 1.4, 24),
        pages[current].height - text.y,
      ),
    });
  }
  renderBindings();
  showPage();
  updateExports();
  const card = [...document.querySelectorAll(".binding-card")].find(
    (e) => e.dataset.bindingId === text.id,
  );
  card?.querySelector("input")?.focus();
}
function renderBindings() {
  $("binding-list").replaceChildren();
  $("mapping-empty").hidden = bindings.length > 0;
  $("clear-bindings").disabled = !bindings.length || processing;
  $("binding-count").textContent =
    `${new Set(bindings.map((b) => b.key)).size} VARIABEL`;
  for (const binding of bindings) {
    const sourcePage = pages.find((p) =>
      p.texts.some((t) => t.id === binding.id),
    );
    const text = sourcePage.texts.find((t) => t.id === binding.id);
    const card = node(
      "div",
      `binding-card${activeId === binding.id ? " active" : ""}`,
    );
    card.dataset.bindingId = binding.id;
    const original = node("p", "binding-original");
    original.append(
      node("small", "", `TEKS ASLI · HALAMAN ${pages.indexOf(sourcePage) + 1}`),
      document.createTextNode(text.text),
    );
    const remove = node("button", "remove-binding", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Hapus variabel ${binding.key}`);
    remove.onclick = () => {
      bindings = bindings.filter((b) => b !== binding);
      renderBindings();
      showPage();
      updateExports();
    };
    card.append(original, remove);
    const inputs = node("div", "binding-inputs");
    const keyWrap = node("div");
    const keyLabel = node("label", "", "Nama variabel");
    const key = node("input");
    key.id = `key-${binding.id}`;
    keyLabel.htmlFor = key.id;
    key.value = binding.key;
    key.spellcheck = false;
    key.setAttribute("aria-label", "Nama variabel");
    key.oninput = () => {
      binding.key = key.value.trim();
      key.setAttribute("aria-invalid", String(!validIdentifier(binding.key)));
      $("binding-count").textContent =
        `${new Set(bindings.map((b) => b.key)).size} VARIABEL`;
      updateExports();
    };
    keyWrap.append(keyLabel, key);
    const typeWrap = node("div"),
      typeLabel = node("label", "", "Tipe"),
      type = node("select");
    type.id = `type-${binding.id}`;
    typeLabel.htmlFor = type.id;
    for (const [value, label] of [
      ["string", "Teks"],
      ["number", "Angka"],
      ["date", "Tanggal"],
    ]) {
      const option = node("option", "", label);
      option.value = value;
      type.append(option);
    }
    type.value = binding.type;
    type.onchange = () => {
      binding.type = type.value;
      renderBindings();
      updateExports();
    };
    typeWrap.append(typeLabel, type);
    inputs.append(keyWrap, typeWrap);
    card.append(inputs);
    const sourceWrap = node("div", "binding-sample"),
      sourceLabel = node("label", "", "Bagian teks yang diganti"),
      sourceInput = node("input");
    sourceInput.id = `source-${binding.id}`;
    sourceLabel.htmlFor = sourceInput.id;
    sourceInput.value = binding.source ?? text.text;
    sourceInput.oninput = () => {
      const previous = binding.source;
      binding.source = sourceInput.value;
      if (binding.sample === previous) {
        binding.sample = binding.source;
        sample.value = binding.sample;
      }
      updateExports();
    };
    sourceWrap.append(sourceLabel, sourceInput);
    card.append(sourceWrap);
    const sampleWrap = node("div", "binding-sample"),
      sampleLabel = node("label", "", "Contoh nilai / pratinjau"),
      sample = node("input");
    sample.id = `sample-${binding.id}`;
    sampleLabel.htmlFor = sample.id;
    sample.type =
      binding.type === "date"
        ? "date"
        : binding.type === "number"
          ? "number"
          : "text";
    if (binding.type === "number") sample.step = "any";
    sample.value = binding.sample;
    sample.oninput = () => {
      binding.sample = sample.value;
      updateExports();
    };
    sampleWrap.append(sampleLabel, sample);
    card.append(sampleWrap);
    const dims = node("div", "binding-dimensions");
    for (const [property, label] of [
      ["width", "Lebar area (pt)"],
      ["height", "Tinggi area (pt)"],
    ]) {
      const wrap = node("div"),
        l = node("label", "", label),
        input = node("input");
      input.type = "number";
      input.min = "1";
      input.step = "0.5";
      input.value = binding[property];
      input.id = `${property}-${binding.id}`;
      l.htmlFor = input.id;
      input.oninput = () => {
        const value = Number(input.value);
        if (Number.isFinite(value) && value > 0) {
          binding[property] = value;
          updateExports();
        }
      };
      wrap.append(l, input);
      dims.append(wrap);
    }
    card.append(dims);
    const requiredLabel = node("label", "required-option"),
      required = node("input");
    required.type = "checkbox";
    required.checked = binding.required;
    required.onchange = () => {
      binding.required = required.checked;
      updateExports();
    };
    requiredLabel.append(required, document.createTextNode("Wajib diisi"));
    card.append(requiredLabel);
    $("binding-list").append(card);
  }
}
async function loadPdf(file) {
  if (processing) return;
  processing = true;
  $("pdf-file").disabled = true;
  $("function-name").disabled = true;
  $("previous-page").disabled = true;
  $("next-page").disabled = true;
  $("download-ts").disabled = true;
  $("download-package").disabled = true;
  let task;
  let passwordProtected = false;
  try {
    if (!file || file.size > 15 * 1024 * 1024)
      throw new Error("Pilih PDF dengan ukuran maksimal 15 MB.");
    if (
      !file.name.toLowerCase().endsWith(".pdf") &&
      file.type !== "application/pdf"
    )
      throw new Error("Format file harus PDF.");
    status("Membaca PDF…");
    task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      disableAutoFetch: true,
      disableStream: true,
      maxImageSize: 16000000,
    });
    task.onPassword = () => {
      passwordProtected = true;
      void task.destroy();
      status("PDF dilindungi kata sandi. Buka proteksi PDF terlebih dahulu.");
    };
    const pdf = await task.promise;
    if (pdf.numPages > 20)
      throw new Error(
        "Maksimal 20 halaman per PDF. Pisahkan dokumen terlebih dahulu.",
      );
    const extracted = [];
    const skipped = new Set([
      pdfjs.OPS.showText,
      pdfjs.OPS.showSpacedText,
      pdfjs.OPS.nextLineShowText,
      pdfjs.OPS.nextLineSetSpacingShowText,
    ]);
    for (let index = 1; index <= pdf.numPages; index++) {
      status(`Membaca halaman ${index} dari ${pdf.numPages}…`);
      const page = await pdf.getPage(index),
        base = page.getViewport({ scale: 1 });
      if (
        base.width > 5000 ||
        base.height > 5000 ||
        base.width <= 0 ||
        base.height <= 0
      )
        throw new Error("Ukuran halaman PDF tidak didukung.");
      const scale = Math.min(
          1.5,
          Math.sqrt(4000000 / (base.width * base.height)),
        ),
        viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport })
        .promise;
      const original = canvas.toDataURL("image/png");
      const content = await page.getTextContent();
      if (content.items.length > 5000)
        throw new Error(
          `Halaman ${index} terlalu kompleks (lebih dari 5.000 potongan teks).`,
        );
      const texts = [];
      for (const [itemIndex, item] of content.items.entries()) {
        if (!("str" in item) || !item.str.trim()) continue;
        const style = content.styles[item.fontName] || {},
          tx = pdfjs.Util.transform(base.transform, item.transform);
        const fontSize = Math.hypot(tx[2], tx[3]),
          angle = Math.atan2(tx[1], tx[0]),
          ascent =
            (style.ascent ?? (style.descent ? 1 + style.descent : 0.8)) *
            fontSize;
        let fontName = "";
        try {
          fontName = page.commonObjs.get(item.fontName)?.name || "";
        } catch {}
        texts.push({
          id: `p${index}-t${itemIndex}`,
          text: item.str,
          x: tx[4] + ascent * Math.sin(angle),
          y: tx[5] - ascent * Math.cos(angle),
          width: Math.abs(item.width),
          height: Math.max(fontSize, 1),
          fontSize: Math.max(fontSize, 1),
          angle: (angle * 180) / Math.PI,
          family: style.fontFamily?.includes("mono")
            ? "monospace"
            : style.fontFamily?.includes("sans")
              ? "sans-serif"
              : "serif",
          bold: /bold|black|heavy/i.test(fontName),
          italic: /italic|oblique/i.test(fontName),
        });
      }
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvasContext: canvas.getContext("2d"),
        viewport,
        annotationMode: pdfjs.AnnotationMode.DISABLE,
        operationsFilter: (op, operatorList) =>
          !skipped.has(operatorList.fnArray[op]),
      }).promise;
      extracted.push({
        width: base.width,
        height: base.height,
        background: canvas.toDataURL("image/png"),
        original,
        texts,
      });
      canvas.width = canvas.height = 0;
      page.cleanup();
    }
    pages = extracted;
    bindings = [];
    current = 0;
    activeId = null;
    $("function-name").value =
      "Template" +
      file.name
        .replace(/\.pdf$/i, "")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((s) => s[0].toUpperCase() + s.slice(1))
        .join("");
    if (!validIdentifier($("function-name").value))
      $("function-name").value = "TemplateDokumen";
    showPage();
    renderBindings();
  } catch (error) {
    status(
      passwordProtected || error.name === "PasswordException"
        ? "PDF dilindungi kata sandi. Buka proteksi terlebih dahulu."
        : `PDF belum dapat dibaca: ${error.message}`,
    );
    return;
  } finally {
    if (task) await task.destroy().catch(() => {});
    processing = false;
    $("pdf-file").disabled = false;
    $("function-name").disabled = false;
    if (pages.length) {
      $("previous-page").disabled = current === 0;
      $("next-page").disabled = current === pages.length - 1;
    }
  }
  updateExports();
}
function download(name, bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = node("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("pdf-file").onchange = () => loadPdf($("pdf-file").files[0]);
$("previous-page").onclick = () => {
  if (current > 0) {
    current--;
    showPage();
  }
};
$("next-page").onclick = () => {
  if (current < pages.length - 1) {
    current++;
    showPage();
  }
};
$("function-name").oninput = updateExports;
$("clear-bindings").onclick = () => {
  bindings = [];
  activeId = null;
  renderBindings();
  showPage();
  updateExports();
};
for (const button of document.querySelectorAll("[data-tab]"))
  button.onclick = () => showTab(button.dataset.tab);
$("download-ts").onclick = () => {
  if (output)
    download(
      $("function-name").value + ".ts",
      output.typescript,
      "text/typescript",
    );
};
$("download-package").onclick = () => {
  if (!output) return;
  const name = $("function-name").value;
  const files = {};
  const add = (path, value) => (files[path] = new TextEncoder().encode(value));
  add(name + ".ts", output.typescript);
  add("template.html", output.html);
  add("schema.json", JSON.stringify(output.schema, null, 2));
  add("sample-data.json", JSON.stringify(output.sampleData, null, 2));
  add("config.json", JSON.stringify(output.config, null, 2));
  add("example.ts", output.usage);
  add(
    "README.md",
    `# ${name}\n\n## TypeScript\nImpor fungsi dari ${name}.ts dan panggil menggunakan data di example.ts. Fungsi menghasilkan string HTML, tanpa dependensi proyek asal.\n\n## DocForge\nSalin template.html, schema.json, sample-data.json, dan config.json ke templates/<id>/. Mulai ulang atau muat ulang daftar template, lalu gunakan /generate.\n\n## Batas konversi\nLayout mengikuti koordinat PDF. Grafik/gambar latar disertakan sebagai PNG data URI, sementara teks yang terdeteksi menjadi elemen HTML. Jenis font dan posisi teks perlu diperiksa. Tabel tidak otomatis berubah menjadi loop; tambahkan loop atau layout mengalir secara manual. PDF scan tidak menjalankan OCR.\n\nHalaman dengan ukuran berbeda tetap memiliki ukuran CSS masing-masing; konfigurasi renderer DocForge mengikuti ukuran halaman pertama.\n`,
  );
  download(name + ".zip", zipSync(files), "application/zip");
};
$("copy-code").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("code-output").value);
    $("copy-code").textContent = "Tersalin ✓";
    setTimeout(() => ($("copy-code").textContent = "Salin kode"), 1800);
  } catch {
    status(
      "Akses clipboard tidak tersedia. Pilih teks pada panel kode lalu salin secara manual.",
    );
  }
};
const drop = document.querySelector(".upload-panel");
drop.addEventListener("dragover", (event) => {
  event.preventDefault();
  drop.classList.add("dragging");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("dragging");
  if (event.dataTransfer.files[0]) loadPdf(event.dataTransfer.files[0]);
});
