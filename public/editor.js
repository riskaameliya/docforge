import * as pdfjs from "/editor-vendor/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/editor-vendor/pdf.worker.mjs";
const $ = (id) => document.getElementById(id);
let fields = [],
  currentPage = 1,
  loaded = false;
function update() {
  $("json").value = JSON.stringify(fields, null, 2);
  document.querySelectorAll(".field").forEach((e) => e.remove());
  for (const f of fields.filter((f) => f.page === currentPage)) {
    const e = document.createElement("div");
    e.className = "field";
    e.style.cssText = `left:${f.x}%;top:${f.y}%;width:${f.width}%;height:${f.height}%`;
    e.textContent = f.key;
    $("stage").append(e);
  }
}
async function show() {
  try {
    const file = $("file").files[0];
    if (!file) return;
    loaded = false;
    currentPage = Number($("page").value);
    const canvas = $("canvas"),
      ctx = canvas.getContext("2d");
    if (file.type === "application/pdf") {
      const task = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      });
      const doc = await task.promise;
      try {
        const page = await doc.getPage(currentPage);
        const viewport = page.getViewport({ scale: 1.3 });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: ctx, viewport }).promise;
      } finally {
        await task.destroy();
      }
    } else {
      currentPage = 1;
      $("page").value = 1;
      const bitmap = await createImageBitmap(file);
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    loaded = true;
    $("status").textContent = "Klik pratinjau untuk menambah field.";
    update();
  } catch (e) {
    $("status").textContent = e.message;
  }
}
$("file").onchange = () => {
  fields = [];
  show();
};
$("show").onclick = show;
$("canvas").onclick = (e) => {
  if (!loaded) return;
  const rect = e.target.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100,
    y = ((e.clientY - rect.top) / rect.height) * 100;
  const width = Number($("width").value),
    height = Number($("height").value),
    fontSize = Number($("size").value);
  if (!$("key").value.trim() || width <= 0 || height <= 0 || fontSize <= 0) {
    $("status").textContent = "Isi key, lebar, tinggi, dan ukuran yang valid.";
    return;
  }
  fields.push({
    key: $("key").value.trim(),
    page: currentPage,
    unit: "percent",
    x: +x.toFixed(2),
    y: +y.toFixed(2),
    width: +Math.min(width, 100 - x).toFixed(2),
    height: +Math.min(height, 100 - y).toFixed(2),
    font: $("font").value,
    fontSize,
    color: $("color").value,
    align: $("align").value,
    wrap: $("wrap").checked,
    autoShrink: $("shrink").checked,
  });
  update();
};
$("undo").onclick = () => {
  fields.pop();
  update();
};
$("export").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(fields, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "fields.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
update();
