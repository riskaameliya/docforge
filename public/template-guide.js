export function templateGuide(functionName, sampleData) {
  const usage = `import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { ${functionName} } from './${functionName}.js';

async function main() {
  // Ganti nilai ini dengan data dari form, API, atau database aplikasimu.
  const html = ${functionName}(${JSON.stringify(sampleData, null, 2).replace(/\n/g, "\n  ")});
  await writeFile('hasil.html', html, 'utf8');

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    // Template sudah menyertakan gambar sebagai data URI; tidak perlu akses jaringan.
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: 'hasil.pdf',
      preferCSSPageSize: true,
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
  console.log('Selesai: hasil.html dan hasil.pdf');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
`;
  const integration = `import { ${functionName} } from './${functionName}.js';

export function tampilkanDokumen(
  container: HTMLElement,
  data: Parameters<typeof ${functionName}>[0],
) {
  const iframe = document.createElement('iframe');
  iframe.title = 'Pratinjau dokumen';
  iframe.setAttribute('sandbox', '');
  iframe.style.width = '100%';
  iframe.style.height = '700px';
  iframe.srcdoc = ${functionName}(data);
  container.replaceChildren(iframe);
}

// Sediakan <div id="preview"></div> di halaman aplikasimu.
const container = document.getElementById('preview');
if (container) {
  tampilkanDokumen(container, ${JSON.stringify(sampleData, null, 2).replace(/\n/g, "\n  ")});
}
`;
  const pdfjs = `// Contoh untuk frontend TypeScript dengan bundler Vite.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

// bytes adalah hasil PDF dari renderer/server aplikasimu, bukan string HTML.
export async function tampilkanPdf(
  bytes: Uint8Array,
  canvas: HTMLCanvasElement,
) {
  const task = getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
  } finally {
    await task.destroy();
  }
}

// Panggil setelah aplikasi menerima byte PDF:
// await tampilkanPdf(pdfBytes, canvasElement);
`;
  const readme = `# Pakai ${functionName} di proyekmu

## File yang ditempel
Salin ${functionName}.ts ke folder template proyek TypeScript kamu. File ini adalah fungsi mandiri yang menerima data dan menghasilkan string HTML. Gambar latar sudah tertanam. Kamu tidak perlu memasang DocForge atau membuat fitur upload/konversi PDF di aplikasimu.

Satu file template cukup untuk dipakai ulang. Impor dan panggil dari file aplikasi yang sudah ada. Jika ingin memisahkan pemanggil, gunakan file kedua seperti preview.ts atau example.ts. Penggabungan ke satu file juga bisa, tetapi tidak wajib.

## Pilih library sesuai hasil yang dibutuhkan
- HTML/pratinjau browser: fungsi template + iframe, tanpa package PDF tambahan.
- PDF dari HTML: renderer HTML-ke-PDF di aplikasimu, contoh Playwright pada Node.js/server.
- Menampilkan PDF yang sudah jadi: pdfjs-dist (PDF.js) di frontend.

Alur jika memakai PDF.js: template(data) -> HTML -> renderer HTML-ke-PDF -> byte PDF -> PDF.js -> canvas. PDF.js tidak menerima string HTML langsung. Jika proyekmu sudah memakai renderer PDF, pakai renderer tersebut tanpa menambahkan Playwright lagi.

## 1. Tempel template dan isi datanya
Contoh frontend TypeScript, dengan elemen <div id="preview"></div> di halaman:
\`\`\`ts
${integration}\`\`\`
Path impor .js dipakai untuk resolusi modul Node/TypeScript; sesuaikan dengan konfigurasi proyekmu. Kode ini memakai DOM dan dijalankan di browser. Untuk React/Vue, panggil fungsi template dari komponen dan pasang HTML ke iframe srcDoc/srcdoc.

## 2. Jika ingin menghasilkan PDF dengan Playwright
Di proyek Node.js yang sudah ada, pasang dependensi yang belum tersedia:
\`\`\`sh
npm install playwright
npm install --save-dev tsx
npx playwright install chromium
npx tsx example.ts
\`\`\`
Atau dengan pnpm:
\`\`\`sh
pnpm add playwright
pnpm add -D tsx
pnpm exec playwright install chromium
pnpm exec tsx example.ts
\`\`\`
Gunakan Node.js 22.13+. tsx hanya untuk menjalankan contoh TypeScript langsung; jika proyek sudah punya proses build/runner, gunakan proses yang ada. node:fs/promises sudah termasuk Node.js. Pada Linux/server, npx playwright install --with-deps chromium dapat diperlukan.

example.ts dari paket ini mengimpor template yang kamu tempel dan menghasilkan hasil.html serta hasil.pdf. Tidak ada proses upload atau konversi PDF asal lagi:
\`\`\`ts
${usage}\`\`\`
Di backend aplikasi, gunakan bagian pemanggilan template dan page.pdf untuk menghasilkan Buffer dan mengirimkannya sebagai application/pdf melalui framework servermu. Contoh example.ts menyimpan ke file agar dapat dicoba langsung; penyimpanan file bukan keharusan integrasi.

## 3. Jika proyekmu memakai PDF.js untuk preview
Pasang pdfjs-dist di frontend:
\`\`\`sh
npm install pdfjs-dist
# atau: pnpm add pdfjs-dist
\`\`\`
Contoh berikut khusus bundler Vite, yang mendukung impor worker ?url. Bundler lain perlu menyesuaikan konfigurasi worker. Gunakan versi worker yang sama dengan pdfjs-dist. Fungsi ini menerima byte PDF yang sudah dihasilkan renderer/servermu dan menampilkan halaman pertama:
\`\`\`ts
${pdfjs}\`\`\`

## File ZIP lainnya
- ${functionName}.ts: template mandiri yang diimpor ke proyekmu.
- example.ts: contoh renderer Playwright.
- template.html: versi Handlebars alternatif, perlu dirender untuk mengganti {{variabel}}.
- schema.json, sample-data.json, config.json: alternatif konfigurasi untuk renderer yang memakai format template DocForge; tidak diperlukan saat memakai fungsi TypeScript.
- README.md: panduan ini.

## Catatan integrasi
Ganti data contoh dengan data form/API/database proyekmu. Tanggal berupa string YYYY-MM-DD. Tipe TypeScript membantu saat pemeriksaan tipe, tetapi validasi runtime tetap dilakukan aplikasi pemanggil. Periksa posisi, font, dan teks yang panjang. Tabel berulang, pagination isi dinamis, dan logika aplikasi perlu ditambahkan manual. Contoh Playwright mengikuti ukuran CSS tiap halaman; renderer lain perlu diperiksa pengaturan ukuran halamannya.

## Dokumentasi
- Playwright: https://playwright.dev/docs/library
- PDF.js: https://mozilla.github.io/pdf.js/examples/
`;

  return { usage, readme, integration, pdfjs };
}
