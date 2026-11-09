# DocForge — Doc Generator

Dokumen baru cukup menambah folder template, tanpa menulis ulang kode layout aplikasi. Service menerima JSON, memvalidasi schema template, lalu mengirim PDF/PNG yang siap diunduh.

## Tahap 1 — HTML

Node.js 22.13+, npm, dan Chromium dibutuhkan. Jalankan:

```sh
npm ci
npx playwright install chromium
cp .env.example .env
# Ubah API_KEY di .env
npm run dev
npm run test:stage1
npm run build
```

`npm run dev` dan `npm start` otomatis membaca file `.env` dari direktori kerja sebelum aplikasi dibuat. Variabel yang sudah diset di shell atau Docker tetap diutamakan. File `.env` boleh tidak ada jika konfigurasi sudah diberikan melalui environment.

```sh
curl localhost:3000/health
curl localhost:3000/templates -H 'x-api-key: change-this-key'
curl localhost:3000/templates/surat-resmi -H 'x-api-key: change-this-key'
curl localhost:3000/generate -H 'x-api-key: change-this-key' \
  -H 'Content-Type: application/json' \
  -d '{"template":"surat-resmi","format":"pdf","data":{"nomor":"001","tanggal":"2026-11-09","penerima":"Dr. Siti, S.T.","isi":"Dengan hormat, kami mengundang Anda.","penandatangan":"Budi Santoso"}}' -o surat.pdf
curl localhost:3000/generate -H 'x-api-key: change-this-key' \
  -H 'Content-Type: application/json' \
  -d '{"template":"laporan","format":"png","data":{"judul":"Laporan","tanggal":"2026-11-09","items":[{"nama":"Buku","jumlah":10}]}}' -o laporan.png
```

Template: `templates/<id>/template.html`, `schema.json`, `sample-data.json`, dan opsional `config.json`. ID hanya huruf, angka, `_`, dan `-`. Schema berbentuk `{"fields":{"nama":{"type":"string","required":true}}}`. Tipe: string, number, date (ISO YYYY-MM-DD valid), array; array objek memakai `items: {fields: {...}}`. Field opsional boleh tidak dikirim; field string wajib tidak boleh kosong. Unknown keys dihapus. Field tanggal tidak dikonversi otomatis.

Handlebars mendukung `{{nama}}`, `{{#each items}}...{{/each}}`, dan `{{#if catatan}}...{{/if}}`. Gunakan placeholder escaped biasa untuk data pengguna. Field opsional gunakan kondisional. HTML dan file template dikelola administrator tepercaya, bukan diunggah oleh klien API.

Config: `{"type":"html","size":"A4","orientation":"portrait","margin":15}`. Size A4/A5/custom; custom membutuhkan `width` dan `height` dalam **mm**, sebelum orientasi diterapkan. Margin mm. PNG adalah satu gambar memanjang untuk seluruh isi; PDF memakai pagination, header tabel berulang. Aset template: `assets/` diakses melalui `/assets/logo.svg`; font global `fonts/` melalui `/fonts/MyFont.ttf` dan `@font-face`.

Chromium digunakan ulang, dengan browser context terpisah per render dan batas concurrency (`RENDER_CONCURRENCY`, default 2; antrean maksimum 100). JavaScript template dinonaktifkan, service worker diblokir, CSP menolak script/frame, dan semua request jaringan ditolak kecuali origin internal yang dilayani dari folder assets/font melalui pemeriksaan realpath. Tidak ada server jaringan di origin internal itu. Strategi routing mengikuti [dokumentasi Playwright](https://playwright.dev/docs/network).

Error konsisten: `{"error":{"code":422,"message":"Data tidak sesuai schema","fields":[{"field":"items.0.jumlah","message":"..."}]}}`. 401 untuk API key, 404 template, 413 body terlalu besar, 422 input, 503 antrean penuh, 500 internal tanpa membocorkan detail. Pino mencatat error di server. `/health` adalah liveness tanpa autentikasi; endpoint lain memakai `x-api-key`.

## Tahap 2 — Overlay dan editor

```sh
npm run test:stage2
API_KEY=change-this-key npm run dev
# Buka http://localhost:3000/editor
curl localhost:3000/generate -H 'x-api-key: change-this-key' \
  -H 'Content-Type: application/json' \
  -d '{"template":"sertifikat","format":"pdf","data":{"nama":"Dr. Siti Nuraini, S.T., M.Eng.","kegiatan":"Pelatihan Digital","tanggal":"2026-11-09","nomor":"CERT-001"}}' -o sertifikat.pdf
# Ganti format menjadi png dan output menjadi sertifikat.png untuk gambar.
```

Font Noto Sans beserta lisensinya disertakan dan digunakan template surat/sertifikat.

Overlay memakai `config.json`: `{"type":"overlay","background":"background.pdf"}` beserta `schema.json`, `sample-data.json`, `fields.json`. Background bisa PDF atau PNG; ukuran mengikuti background, config halaman HTML tidak diterapkan. Contoh fields:

```json
[{"key":"nama","page":1,"unit":"percent","x":12,"y":43,"width":76,"height":12,"font":"Helvetica","fontSize":32,"minFontSize":6,"color":"#264d66","align":"center","autoShrink":true,"wrap":true}]
```

Titik asal **kiri atas**, y turun. `percent`: x/width terhadap lebar halaman, y/height terhadap tinggi halaman, rentang 0–100; `pt`: 1/72 inci. Ukuran font selalu pt. PNG dianggap 96 dpi (96 px = 72 pt). `page` dimulai dari 1. Kotak wajib berada dalam halaman. Font default Helvetica; untuk Unicode di luar Latin, taruh TTF di `fonts/`, lalu isi `font` dengan nama file. Auto-shrink berhenti di minFontSize; teks yang masih tidak muat menghasilkan 422, bukan dipotong diam-diam. Wrap mendukung newline dan pemenggalan baris termasuk kata yang sangat panjang.

pdf-lib mempertahankan desain PDF dan menambahkan teks terukur. PDF.js + @napi-rs/canvas merasterisasi hasil yang sama ke PNG; sharp membaca ukuran PNG background dan mengodekan hasil. PDF multi-halaman tetap utuh dalam PDF; output PNG mengambil **halaman pertama**. Overlay dipilih untuk desain sertifikat/formulir yang sudah jadi, sementara HTML cocok untuk tabel dan aliran konten dinamis. Background berotasi sebaiknya dinormalisasi ke rotasi 0 sebelum digunakan.

Editor `/editor` terbuka tanpa API key karena seluruh file diproses lokal di browser. Unggah background, pilih halaman PDF, isi pengaturan, klik posisi, dan ekspor fields.json. Kotak menunjukkan posisi, bukan simulasi tipografi final; periksa hasil `/generate` sebelum memakai template. Simpan background dan JSON hasil ekspor secara manual ke folder template. Tidak ada upload template ke server.

## Tahap 3 — Batch dengan Redis

```sh
cp .env.example .env
# Ubah API_KEY di .env sebelum deployment
# Docker menjalankan app dan Redis dengan volume persisten.
docker compose up --build -d
docker compose logs -f app
# Untuk tes lokal: hidupkan Redis, lalu:
REDIS_URL=redis://localhost:6379 npm run test:stage3
# Semua tes (Redis nyata diperlukan):
REDIS_URL=redis://localhost:6379 npm test
```

Tanpa REDIS_URL, mode lokal hanya mengaktifkan Tahap 1–2. Untuk batch di dev, ekspor REDIS_URL sebelum `npm run dev`. App dan worker BullMQ berjalan dalam satu proses, dengan browser dan limiter yang sama. Worker memproses satu batch sekaligus, baris secara berurutan; antrean Redis menjaga request batch tetap cepat. ZIP ditulis ke disk secara inkremental agar seluruh hasil tidak disimpan sekaligus dalam memori.

```sh
curl localhost:3000/generate/batch -H 'x-api-key: change-this-key' \
  -H 'Content-Type: application/json' \
  -d '{"template":"sertifikat","format":"pdf","filenameField":"nama","data":[{"nama":"Dr. Siti, S.T.","kegiatan":"Pelatihan Digital","tanggal":"2026-11-09","nomor":"CERT-001"},{"nama":""}]}'
# Response 202: {"id":"1","statusUrl":"/jobs/1"}
curl localhost:3000/jobs/1 -H 'x-api-key: change-this-key'
curl localhost:3000/jobs/1/download -H 'x-api-key: change-this-key' -o batch.zip
```

Status: waiting/active/completed/failed, progres persen, hasil `{total,succeeded,failures}` dan downloadUrl setelah completed. Baris invalid tercatat di failures dengan index **mulai 0** dan error field; baris lain tetap diproses. `report.json` selalu ada dalam ZIP, termasuk jika semua baris gagal. `filenameField` mengambil field tingkat atas; nama disanitasi dan diberi prefiks nomor urut agar unik dan aman terhadap path traversal. Download job belum selesai menghasilkan 409. API key yang sama bisa membaca semua job; layanan ini belum memiliki isolasi multi-tenant.

Batas default body 1 MiB (`BODY_LIMIT`) dan batch 100 item (`BATCH_LIMIT`), format pdf/png. Data batch harus array objek; kesalahan envelope ditolak sebelum enqueue, sedangkan kesalahan data tiap dokumen ditangani worker. BullMQ mempertahankan metadata maksimal 24 jam/1.000 job selesai (pembersihan dilakukan saat ada job baru, sesuai [dokumentasi BullMQ](https://docs.bullmq.io/guide/workers/auto-removal-of-jobs)). Arsip output disimpan pada volume Docker; gunakan satu volume bersama jika proses app diperbanyak.

## Pengujian dan keputusan teknis

- Tahap 1: schema, nested array, tanggal invalid, optional/required, Unicode, autentikasi, header unduhan, PDF/PNG valid, laporan 130 baris lintas halaman.
- Tahap 2: posisi relatif/pt, bounds, wrapping/shrink/overflow, field kosong, latar PDF maupun PNG, jumlah halaman dan ukuran gambar.
- Tahap 3: Redis/BullMQ nyata, progres, kegagalan parsial, ZIP valid, penamaan aman, limit dan endpoint HTTP batch.

Playwright memakai mesin layout browser untuk CSS, font, tabel dan pagination, sehingga penambahan dokumen HTML tidak mengubah kode aplikasi. Overlay mempertahankan desain latar tanpa harus membuat ulangnya sebagai HTML. Zod memvalidasi envelope dan membangun validator dari schema template. Redis memisahkan pekerjaan batch dari waktu respons HTTP; file hasil tidak disimpan dalam Redis. SIGTERM/SIGINT menutup worker dan browser. `/health` hanya liveness proses, bukan pemeriksaan kesiapan Redis.

Di Docker Chromium berjalan sebagai user node dengan sandbox browser dinonaktifkan untuk kompatibilitas container; isolasi render tetap menerapkan JavaScript off, pemblokiran jaringan, dan pemeriksaan file lokal. Jalankan layanan di container tersendiri dan letakkan TLS/reverse proxy di depan untuk penggunaan di jaringan publik.

Data contoh `laporan/sample-data.json` berisi 80 baris untuk menunjukkan pagination. Chromium diberi batas waktu render 30 detik per dokumen; PNG HTML dibatasi 60 juta piksel. Arsip di OUTPUT_DIR disimpan sampai dihapus operator; jadwalkan pembersihan sesuai kebijakan retensi aplikasi.
