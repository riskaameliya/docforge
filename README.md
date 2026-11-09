# DocForge — Doc Generator

Dokumen baru cukup menambah folder template, tanpa menulis ulang kode layout aplikasi. Service menerima JSON, memvalidasi schema template, lalu mengirim PDF/PNG yang siap diunduh.

## Gunakan lewat browser

Jalankan `npm run dev`, lalu buka **http://localhost:3000**. Masukkan nilai `API_KEY` dari file `.env` (bukan `.env.example`) pada dialog koneksi. Setelah terhubung, semua pembuatan dokumen dapat dilakukan di UI tanpa Postman atau curl:

1. Pilih template sertifikat, surat resmi, atau laporan.
2. Isi form; tabel laporan mendukung tambah/hapus baris. Tombol **Data contoh** mengembalikan contoh bawaan.
3. Pilih PDF/PNG, klik **Buat dokumen**, lalu periksa pratinjau dan unduh hasilnya.

**Impor JSON** menerima objek data untuk satu dokumen atau array objek untuk berpindah ke mode **Sekaligus**. Mode ini menampilkan progres dan menyediakan ZIP beserta laporan kegagalan; layanan batch/Redis harus aktif. Editor overlay dapat dibuka dari navigasi **Editor template**.

API key dikirim melalui header oleh UI. Jika opsi ingat diaktifkan, key disimpan di sessionStorage selama tab terbuka; tombol koneksi menyediakan opsi putuskan koneksi. Key tidak ditanam dalam HTML atau JavaScript. File UI dilayani langsung oleh Fastify, memakai aset/font lokal, dan ikut tersedia di image Docker tanpa build frontend tambahan.

Jalankan `npm run test:ui` untuk tes browser: login benar/salah, form otomatis, PDF/PNG dan unduhan, impor data, edit tabel, tampilan ponsel, serta alur batch (respons batch dimock dalam tes UI; integrasi Redis diuji terpisah dengan `test:stage3`).

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

## PDF ke template TypeScript

Buka **http://localhost:3000/converter** atau menu **PDF ke kode**. Pilih/seret PDF (maksimal 15 MB, 20 halaman). File diproses lokal di browser tanpa dikirim ke server. Pilih teks pada PDF, beri nama variabel seperti `nomorSurat`, pilih tipe dan contoh nilai. Kolom **Bagian teks yang diganti** memungkinkan penggantian sebagian teks: `Nomor: 001/2026` dapat menjadi `Nomor: {{nomorSurat}}`. Pemetaan dilakukan per potongan teks yang terdeteksi; satu potongan mendukung satu penggantian, pada kemunculan pertama substring yang dipilih. Variabel yang sama dapat dipakai pada beberapa potongan jika tipe, kewajiban, dan contohnya sama.

Isi nama fungsi, misalnya `TemplateSuratPemanggilan`. Panel hasil menyediakan pratinjau HTML, kode TypeScript/HTML, schema/data dan contoh pemakaian. Unduh `.ts` langsung atau paket ZIP yang berisi:

- `<NamaFungsi>.ts`: fungsi mandiri bertipe yang mengembalikan string HTML; data dinamis di-escape.
- `template.html`, `schema.json`, `sample-data.json`, `config.json`: siap disalin ke `templates/<id>/` dan digunakan oleh `/generate` atau UI setelah memuat ulang daftar template.
- `example.ts` dan `README.md`: contoh integrasi ke aplikasi.

Contoh setelah memetakan field `nomorSurat`:

```ts
import { TemplateSuratPemanggilan } from './TemplateSuratPemanggilan';

const html = TemplateSuratPemanggilan({ nomorSurat: '002/BPSDM/2026' });
// Gunakan string html dengan renderer PDF aplikasi Anda.
```

Konverter mempertahankan koordinat halaman PDF. Grafik/gambar menjadi PNG tertanam; teks yang terbaca menjadi elemen HTML. Font, warna teks, dan posisi hasilnya perlu diperiksa. Font sumber dapat diganti ke font aplikasi pada kode hasil ekspor. PDF scan tidak menjalankan OCR: gunakan editor overlay untuk menambah teks pada latar scan. Struktur semantik tabel, loop `peserta.map(...)`, import entity, pemformatan tanggal, dan relasi data aplikasi seperti contoh surat pemanggilan tidak dapat disimpulkan dari PDF; tambahkan logika tersebut pada kode hasil ekspor. Untuk tabel panjang yang perlu mengalir ke halaman baru, gunakan template HTML dengan loop. Pada PDF dengan ukuran halaman berbeda, CSS menyimpan ukuran masing-masing, sementara config renderer DocForge mengikuti halaman pertama.

Tes `npm run test:converter` memeriksa pemetaan substring, escape HTML/kode, TypeScript strict, PDF beberapa halaman, pemisahan grafik dari teks, ZIP yang dapat dipasang sebagai template, serta tampilan desktop/ponsel.
