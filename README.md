# DocForge — Doc Generator

Dokumen baru cukup menambah folder template, tanpa menulis ulang kode layout aplikasi. Service menerima JSON, memvalidasi schema template, lalu mengirim PDF/PNG yang siap diunduh.

## Gunakan lewat browser

Jalankan `npm run dev`, lalu buka **http://localhost:3000**. Tanpa login atau API key, semua pembuatan dokumen dapat dilakukan di UI tanpa Postman atau curl:

1. Pilih template sertifikat, surat resmi, atau laporan.
2. Isi form; tabel laporan mendukung tambah/hapus baris. Tombol **Data contoh** mengembalikan contoh bawaan.
3. Pilih PDF/PNG, klik **Buat dokumen**, lalu periksa pratinjau dan unduh hasilnya.

**Impor JSON** menerima objek data untuk satu dokumen atau array objek untuk berpindah ke mode **Sekaligus**. Mode ini memproses dokumen sekaligus dan menyediakan ZIP beserta laporan kegagalan, tanpa Redis. Editor overlay dapat dibuka dari navigasi **Editor template**.

Data untuk pembuatan dokumen dikirim ke server dan diproses sementara di memori, lalu hasil dikirim langsung ke browser. Hasil tidak diarsipkan, tidak memiliki URL publik, dan respons memakai `Cache-Control: no-store`. Batch menghasilkan ZIP di memori, maksimal 64 MB dan 100 item (`BATCH_LIMIT`). Isi dokumen tidak dicatat di log aplikasi. Converter dan editor memproses file lokal di browser.

Endpoint generate dibatasi 60 permintaan per IP per menit per proses. Aplikasi memakai alamat koneksi langsung; jika memakai reverse proxy, atur pembatasan IP pengguna pada proxy. Gunakan HTTPS untuk deployment publik. Template dan contoh bawaan bersifat publik; jangan menaruh data pribadi pengguna di folder template.

Jalankan `npm run test:ui` untuk tes browser tanpa login, form, pratinjau/unduhan, impor JSON, batch, dan tampilan ponsel.

## Tahap 1 — HTML

Node.js 22.13+, npm, dan Chromium dibutuhkan. Jalankan:

```sh
npm ci
npx playwright install chromium
cp .env.example .env
npm run dev
npm run test:stage1
npm run build
```

`npm run dev` dan `npm start` otomatis membaca file `.env` dari direktori kerja sebelum aplikasi dibuat. Variabel yang sudah diset di shell atau Docker tetap diutamakan. File `.env` boleh tidak ada jika konfigurasi sudah diberikan melalui environment.

```sh
curl localhost:3000/health
curl localhost:3000/templates
curl localhost:3000/templates/surat-resmi
curl localhost:3000/generate \
  -H 'Content-Type: application/json' \
  -d '{"template":"surat-resmi","format":"pdf","data":{"nomor":"001","tanggal":"2026-11-09","penerima":"Dr. Siti, S.T.","isi":"Dengan hormat, kami mengundang Anda.","penandatangan":"Budi Santoso"}}' -o surat.pdf
curl localhost:3000/generate \
  -H 'Content-Type: application/json' \
  -d '{"template":"laporan","format":"png","data":{"judul":"Laporan","tanggal":"2026-11-09","items":[{"nama":"Buku","jumlah":10}]}}' -o laporan.png
```

Template: `templates/<id>/template.html`, `schema.json`, `sample-data.json`, dan opsional `config.json`. ID hanya huruf, angka, `_`, dan `-`. Schema berbentuk `{"fields":{"nama":{"type":"string","required":true}}}`. Tipe: string, number, date (ISO YYYY-MM-DD valid), array; array objek memakai `items: {fields: {...}}`. Field opsional boleh tidak dikirim; field string wajib tidak boleh kosong. Unknown keys dihapus. Field tanggal tidak dikonversi otomatis.

Handlebars mendukung `{{nama}}`, `{{#each items}}...{{/each}}`, dan `{{#if catatan}}...{{/if}}`. Gunakan placeholder escaped biasa untuk data pengguna. Field opsional gunakan kondisional. HTML dan file template dikelola administrator tepercaya, bukan diunggah oleh klien API.

Config: `{"type":"html","size":"A4","orientation":"portrait","margin":15}`. Size A4/A5/custom; custom membutuhkan `width` dan `height` dalam **mm**, sebelum orientasi diterapkan. Margin mm. PNG adalah satu gambar memanjang untuk seluruh isi; PDF memakai pagination, header tabel berulang. Aset template: `assets/` diakses melalui `/assets/logo.svg`; font global `fonts/` melalui `/fonts/MyFont.ttf` dan `@font-face`.

Chromium digunakan ulang, dengan browser context terpisah per render dan batas concurrency (`RENDER_CONCURRENCY`, default 2; antrean maksimum 100). JavaScript template dinonaktifkan, service worker diblokir, CSP menolak script/frame, dan semua request jaringan ditolak kecuali origin internal yang dilayani dari folder assets/font melalui pemeriksaan realpath. Tidak ada server jaringan di origin internal itu. Strategi routing mengikuti [dokumentasi Playwright](https://playwright.dev/docs/network).

Error konsisten: `{"error":{"code":422,"message":"Data tidak sesuai schema","fields":[{"field":"items.0.jumlah","message":"..."}]}}`. 404 template, 413 body terlalu besar, 422 input, 503 antrean penuh, 500 internal tanpa membocorkan detail. Pino mencatat error di server. Semua endpoint publik tanpa autentikasi; generate mengembalikan 429 jika batas permintaan terlampaui.

## Tahap 2 — Overlay dan editor

```sh
npm run test:stage2
npm run dev
# Buka http://localhost:3000/editor
curl localhost:3000/generate \
  -H 'Content-Type: application/json' \
  -d '{"template":"sertifikat","format":"pdf","data":{"nama":"Dr. Siti Nuraini, S.T., M.Eng.","kegiatan":"Pelatihan Digital","tanggal":"2026-11-09","nomor":"CERT-001"}}' -o sertifikat.pdf
# Ganti format menjadi png dan output menjadi sertifikat.png untuk gambar.
```

Font Noto Sans beserta lisensinya disertakan dan digunakan template surat/sertifikat.

Overlay memakai `config.json`: `{"type":"overlay","background":"background.pdf"}` beserta `schema.json`, `sample-data.json`, `fields.json`. Background bisa PDF atau PNG; ukuran mengikuti background, config halaman HTML tidak diterapkan. Contoh fields:

```json
[
  {
    "key": "nama",
    "page": 1,
    "unit": "percent",
    "x": 12,
    "y": 43,
    "width": 76,
    "height": 12,
    "font": "Helvetica",
    "fontSize": 32,
    "minFontSize": 6,
    "color": "#264d66",
    "align": "center",
    "autoShrink": true,
    "wrap": true
  }
]
```

Titik asal **kiri atas**, y turun. `percent`: x/width terhadap lebar halaman, y/height terhadap tinggi halaman, rentang 0–100; `pt`: 1/72 inci. Ukuran font selalu pt. PNG dianggap 96 dpi (96 px = 72 pt). `page` dimulai dari 1. Kotak wajib berada dalam halaman. Font default Helvetica; untuk Unicode di luar Latin, taruh TTF di `fonts/`, lalu isi `font` dengan nama file. Auto-shrink berhenti di minFontSize; teks yang masih tidak muat menghasilkan 422, bukan dipotong diam-diam. Wrap mendukung newline dan pemenggalan baris termasuk kata yang sangat panjang.

pdf-lib mempertahankan desain PDF dan menambahkan teks terukur. PDF.js + @napi-rs/canvas merasterisasi hasil yang sama ke PNG; sharp membaca ukuran PNG background dan mengodekan hasil. PDF multi-halaman tetap utuh dalam PDF; output PNG mengambil **halaman pertama**. Overlay dipilih untuk desain sertifikat/formulir yang sudah jadi, sementara HTML cocok untuk tabel dan aliran konten dinamis. Background berotasi sebaiknya dinormalisasi ke rotasi 0 sebelum digunakan.

Editor `/editor` terbuka tanpa API key karena seluruh file diproses lokal di browser. Unggah background, pilih halaman PDF, isi pengaturan, klik posisi, dan ekspor fields.json. Kotak menunjukkan posisi, bukan simulasi tipografi final; periksa hasil `/generate` sebelum memakai template. Simpan background dan JSON hasil ekspor secara manual ke folder template. Tidak ada upload template ke server.

## Batch dan deployment

```sh
docker compose up --build -d
npm test
npm run build
```

`POST /generate/batch` menerima `{template, format, data: [...], filenameField?}` dan langsung mengembalikan ZIP (HTTP 200), tanpa antrean Redis, arsip disk, atau endpoint `/jobs`. ZIP berisi dokumen berhasil dan `report.json` dengan `{total,succeeded,failures}`. Indeks kegagalan dimulai dari 0. Nama file disanitasi dan diberi nomor urut. Hanya kesalahan validasi per dokumen yang dicatat sebagai kegagalan parsial; kesalahan layanan membatalkan batch.

Satu batch diproses pada satu waktu, dengan maksimal dua batch menunggu per proses. Batas waktu pemrosesan batch diperiksa di antara dokumen (120 detik), dan render setiap dokumen dibatasi 30 detik. Browser harus tetap terbuka hingga unduhan tersedia. Data tidak dapat dipulihkan setelah permintaan selesai atau gagal.

Konfigurasi `.env` lama seperti `API_KEY`, `REDIS_URL`, dan `OUTPUT_DIR` tidak lagi digunakan. Arsip dan volume Redis dari versi lama tidak otomatis dihapus; perubahan ini berlaku untuk pemrosesan baru.

Di Docker Chromium berjalan sebagai user node dengan sandbox browser dinonaktifkan untuk kompatibilitas container. Isolasi render tetap memblokir JavaScript dan jaringan eksternal serta memeriksa akses file lokal. Gunakan HTTPS/reverse proxy di depan layanan publik.

## PDF ke template TypeScript

Buka **http://localhost:3000/converter** atau menu **PDF ke kode**. Pilih/seret PDF (maksimal 15 MB, 20 halaman). File diproses lokal di browser tanpa dikirim ke server. Pilih teks pada PDF, beri nama variabel seperti `nomorSurat`, pilih tipe dan contoh nilai. Kolom **Bagian teks yang diganti** memungkinkan penggantian sebagian teks: `Nomor: 001/2026` dapat menjadi `Nomor: {{nomorSurat}}`. Pemetaan dilakukan per potongan teks yang terdeteksi; satu potongan mendukung satu penggantian, pada kemunculan pertama substring yang dipilih. Variabel yang sama dapat dipakai pada beberapa potongan jika tipe, kewajiban, dan contohnya sama.

Isi nama fungsi, misalnya `TemplateSuratPemanggilan`. Panel hasil menyediakan pratinjau HTML, kode TypeScript/HTML, schema/data dan contoh pemakaian. Unduh `.ts` langsung atau paket ZIP yang berisi:

- `<NamaFungsi>.ts`: fungsi mandiri bertipe yang mengembalikan string HTML; data dinamis di-escape.
- `template.html`, `schema.json`, `sample-data.json`, `config.json`: siap disalin ke `templates/<id>/` dan digunakan oleh `/generate` atau UI setelah memuat ulang daftar template.
- `example.ts` dan `README.md`: contoh integrasi ke aplikasi.

Contoh setelah memetakan field `nomorSurat`:

```ts
import { TemplateSuratPemanggilan } from "./TemplateSuratPemanggilan";

const html = TemplateSuratPemanggilan({ nomorSurat: "002/BPSDM/2026" });
// Gunakan string html dengan renderer PDF aplikasi Anda.
```

Konverter mempertahankan koordinat halaman PDF. Grafik/gambar menjadi PNG tertanam; teks yang terbaca menjadi elemen HTML. Font, warna teks, dan posisi hasilnya perlu diperiksa. Font sumber dapat diganti ke font aplikasi pada kode hasil ekspor. PDF scan tidak menjalankan OCR: gunakan editor overlay untuk menambah teks pada latar scan. Struktur semantik tabel, loop `peserta.map(...)`, import entity, pemformatan tanggal, dan relasi data aplikasi seperti contoh surat pemanggilan tidak dapat disimpulkan dari PDF; tambahkan logika tersebut pada kode hasil ekspor. Untuk tabel panjang yang perlu mengalir ke halaman baru, gunakan template HTML dengan loop. Pada PDF dengan ukuran halaman berbeda, CSS menyimpan ukuran masing-masing, sementara config renderer DocForge mengikuti halaman pertama.

Tes `npm run test:converter` memeriksa pemetaan substring, escape HTML/kode, TypeScript strict, PDF beberapa halaman, pemisahan grafik dari teks, ZIP yang dapat dipasang sebagai template, serta tampilan desktop/ponsel.

## Background sertifikat milik pengguna

Pada template **Sertifikat**, pilih PNG/JPG maksimal 5 MB dan 16 megapiksel. Gunakan A4 landscape (297 × 210 mm), misalnya 1684 × 1190 px atau 3508 × 2480 px. Gambar mengisi satu halaman PDF 842 × 595 pt; gambar dengan rasio berbeda dipasang utuh dengan ruang putih, tanpa dipotong. Agar area teks sesuai panduan, gunakan desain berasio A4. Hasil PNG memakai rasterisasi 96 dpi.

Buka **Panduan menyiapkan desain sertifikat** di form dan unduh SVG panduan. Sisakan area kosong berikut, dihitung dari kiri atas:

| Data     | Kiri  | Atas   | Lebar  | Tinggi |
| -------- | ----- | ------ | ------ | ------ |
| Nama     | 12%   | 43%    | 76%    | 12%    |
| Kegiatan | 15%   | 63%    | 70%    | 10%    |
| Tanggal  | 30%   | 75%    | 40%    | 6%     |
| Nomor    | 45 pt | 535 pt | 300 pt | 25 pt  |

Judul, logo, bingkai, tanda tangan, dan label tetap harus sudah ada pada gambar. Jangan sertakan data peserta atau kotak panduan dalam desain akhir. Gunakan latar terang di area teks. Posisi dapat digeser melalui pengaturan field pada form; periksa pratinjau sebelum mencetak.

API `/generate` dan `/generate/batch` menerima properti opsional `background` berupa data URI `data:image/png;base64,...` atau `data:image/jpeg;base64,...`, khusus template `sertifikat`. Body generate dibatasi 8 MiB untuk mengakomodasi gambar base64. Background divalidasi dan dinormalisasi di memori tanpa penulisan disk. Pada batch satu gambar digunakan untuk semua dokumen. Template bawaan tidak berubah, dan pengguna lain tidak menerima gambar tersebut. Tombol **Gunakan desain bawaan** menghapus pilihan gambar pada tab tersebut.

## Kolom laporan custom

Pilih **Laporan**, lalu gunakan panel **Kolom laporan** untuk menambah, menghapus, mengganti judul atau tipe, menandai wajib, dan mengurutkan kolom dengan tombol panah. Maksimal 12 kolom; minimal satu kolom. Kolom bawaan tetap Nama, Jumlah, dan Keterangan. Tombol **Kembalikan kolom bawaan** mengembalikan susunan awal. Menghapus kolom menghilangkan nilainya dari form; mengubah tipe dapat mengosongkan nilai yang tidak cocok.

Pengaturan berlaku untuk PDF/PNG serta seluruh dokumen batch di tab tersebut, tanpa disimpan ke server. Untuk impor JSON, isi `items` dengan key yang ditampilkan pada panel kolom. Judul dan tanggal laporan tetap tersedia.

API `/generate` dan `/generate/batch` menerima `columns` opsional, khusus template `laporan`:

```json
[
  {
    "key": "produk",
    "label": "Nama produk",
    "type": "string",
    "required": true
  },
  {
    "key": "harga",
    "label": "Harga satuan",
    "type": "number",
    "required": true
  }
]
```

Data baris contohnya `{"produk":"Buku","harga":12500}` di dalam `items`. Tipe yang tersedia: `string`, `number`, `date` (YYYY-MM-DD). Key harus unik, diawali huruf, dan hanya menggunakan huruf/angka/underscore (maksimal 40 karakter). Jika `columns` tidak dikirim, sistem memakai kolom bawaan. Label dan isi sel di-escape saat render.

## Field dan posisi sertifikat custom

Buka **Atur field dan posisi teks sertifikat**. Tambahkan atau hapus field (1–20), ubah label, tipe data (teks/angka/tanggal), status wajib, ukuran font, warna, dan perataan. Geser kotak pada peta background menggunakan mouse/sentuhan atau tombol panah (1% per langkah). Posisi kiri/atas serta lebar/tinggi memakai persen dari halaman A4; kotak dibatasi di dalam halaman. Peta menunjukkan area field, sementara hasil tipografi sebenarnya diperiksa melalui PDF/PNG. Tanpa gambar upload, peta memakai latar kosong untuk acuan posisi.

Label field adalah judul input, bukan teks yang dicetak. Elemen tetap yang sudah menyatu dengan background bawaan tidak dapat dihapus lewat pengaturan field; unggah background sendiri untuk menggantinya. Field bawaan dapat dikembalikan dengan tombol **Kembalikan field bawaan**. Menghapus field menghapus nilainya dari form; mengubah tipe dapat mengosongkan nilai yang tidak cocok.

API generate dan batch menerima `certificateFields` opsional, khusus template `sertifikat`, misalnya:

```json
[
  {
    "key": "instansi",
    "label": "Instansi",
    "type": "string",
    "required": true,
    "x": 10,
    "y": 40,
    "width": 80,
    "height": 12,
    "fontSize": 24,
    "color": "#172b4d",
    "align": "center"
  }
]
```

Data contohnya `{"instansi":"Universitas Contoh"}`. Font memakai Noto Sans bawaan dengan wrap dan auto-shrink; font minimum 6 pt. Field wajib divalidasi terhadap data. Pada batch, pengaturan yang sama berlaku pada semua dokumen. Pengaturan hanya berada di tab browser dan permintaan, tanpa mengubah template atau menyimpan data ke server.

## Surat dengan kop atau template sendiri

Pada **Surat resmi**, aktifkan **Gunakan kop/template sendiri dan atur posisi isi**. Mode custom memakai A4 portrait (595 × 842 pt). Unggah PNG/JPG atau PDF satu halaman, maksimal 5 MB. Kop berupa gambar pendek ditempatkan di atas halaman; template penuh ditempatkan utuh tanpa dipotong. File Word perlu diekspor ke PDF terlebih dahulu.

PDF dirasterisasi lokal di browser menjadi gambar sebelum dikirim. Template beberapa halaman dan PDF berpassword ditolak dengan pesan pada upload. Isi tetap, kop, logo, dan tanda tangan yang sudah ada pada gambar dipertahankan. Field dinamis ditambahkan di atasnya; hapus isi contoh pada template terlebih dahulu agar tidak bertumpuk.

Buka **Atur field dan posisi isi surat** untuk menggeser field, mengubah ukurannya, menambah/menghapus field, dan mengatur font/warna/perataan. Label field hanya judul input, bukan teks yang dicetak. Tanpa upload, mode custom memakai halaman putih. Pengaturan surat dan sertifikat terpisah di tab browser dan tidak mengubah template server.

Mode custom berupa satu halaman dengan area teks tetap dan auto-shrink; isi yang masih tidak muat pada font minimum ditolak. Untuk surat panjang dengan alur teks dan pergantian halaman otomatis, nonaktifkan mode custom untuk kembali ke format HTML bawaan.

API `/generate` dan `/generate/batch` menerima `letterFields` untuk `surat-resmi`, dengan struktur yang sama seperti `certificateFields`, serta `background` berupa data URI PNG/JPEG opsional. Jika hanya background dikirim, field surat bawaan dipakai. Hasil langsung dikirim sebagai PDF/PNG/ZIP tanpa arsip di server.
