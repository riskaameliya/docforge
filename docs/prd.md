TUGAS: Bangun "Doc Generator", service untuk menghasilkan dokumen PDF dan PNG yang bisa diunduh dari data JSON menggunakan template, supaya developer tidak perlu menulis kode layout manual tiap ada dokumen baru.

MASALAH YANG DISELESAIKAN
Setiap kali aplikasi butuh output dokumen (sertifikat, surat, laporan, kartu), developer harus membuat format/layout lewat kode (koordinat, font, tabel, pindah halaman). Ini lama dan sulit dirawat. Target: dokumen baru cukup dengan menambah template, tanpa mengubah kode aplikasi.

STACK

- Node.js + TypeScript, Fastify
- Playwright (Chromium headless) untuk render HTML ke PDF/PNG
- pdf-lib untuk mengisi field di atas PDF latar
- sharp atau @napi-rs/canvas untuk mengisi field di atas PNG latar
- Zod untuk validasi
- BullMQ + Redis untuk batch (tahap 3)
- Vitest untuk test
- Docker + docker-compose

FITUR TAHAP 1: Template HTML ke PDF/PNG

1. Template HTML disimpan di folder templates/<id>/ berisi template.html, schema.json, dan sample-data.json.
2. Gunakan Handlebars untuk placeholder, mendukung loop (untuk tabel) dan kondisional.
3. schema.json mendefinisikan field: nama, tipe (string, number, date, array), wajib/tidak. Validasi data masuk dengan schema ini dan kembalikan error 422 yang jelas per field.
4. Endpoint POST /generate
   Body: { "template": "<id>", "format": "pdf" | "png", "data": { ... } }
   Response: file biner dengan Content-Type dan Content-Disposition (attachment) yang benar.
5. Opsi halaman: ukuran (A4, A5, custom), orientasi, margin; boleh didefinisikan per template di config.json.
6. Dukungan font kustom dari folder fonts/ dan gambar (logo, tanda tangan) dari folder assets/ per template.
7. Endpoint GET /templates (daftar) dan GET /templates/:id (schema + sample data).
8. Reuse satu instance browser Chromium (jangan launch per request) dan batasi concurrency.

FITUR TAHAP 2: PDF/PNG sebagai latar + field overlay

1. Template jenis "overlay": berisi file background (PDF atau PNG) dan fields.json.
2. fields.json berisi daftar field: key, x, y, lebar, tinggi, font, ukuran, warna, alignment (left/center/right), auto-shrink kalau teks terlalu panjang, dan wrap teks multi-baris.
3. Koordinat dalam satuan relatif (persen) atau poin PDF, dengan titik asal kiri-atas; dokumentasikan satuannya dengan jelas.
4. Generate: baca background, tulis data ke posisi field, keluarkan PDF atau PNG.
5. Halaman kecil (HTML statis) untuk pratinjau: upload background, klik posisi untuk menambah field, ekspor fields.json. Boleh sederhana.

FITUR TAHAP 3: Batch

1. POST /generate/batch dengan array data, satu template.
2. Diproses lewat BullMQ; response berisi job id.
3. GET /jobs/:id untuk status dan progres; saat selesai, unduh ZIP berisi semua file.
4. Penamaan file di ZIP bisa memakai field dari data (misalnya nama atau nomor).
5. Satu baris gagal tidak menghentikan batch; laporkan daftar kegagalan di akhir.

NON-FUNGSIONAL

- Autentikasi sederhana lewat API key di header.
- Batas ukuran body dan batas jumlah item batch.
- Template di-sandbox: jangan izinkan eksekusi JavaScript dari template, dan blokir akses jaringan dari Chromium saat render kecuali ke asset lokal.
- Logging terstruktur (pino), error handling konsisten.
- Endpoint /health.

TEST

- Unit test untuk validasi schema dan perhitungan posisi field.
- Integration test: generate tiap template contoh dan pastikan hasilnya PDF/PNG valid (cek header file dan jumlah halaman).
- Test kasus tepi: teks sangat panjang, field kosong, karakter Unicode (nama Indonesia dengan gelar), tabel melebihi satu halaman.

DELIVERABLES

- Struktur proyek rapi (src/, templates/, test/)
- 3 template contoh: sertifikat (overlay), surat resmi (HTML), laporan dengan tabel panjang (HTML)
- README: masalah awal, cara menjalankan (Docker), contoh curl untuk tiap endpoint, cara menambah template baru, keputusan teknis (kenapa Playwright, kenapa overlay)
- docker-compose.yml untuk app + Redis
- Script npm: dev, build, test

URUTAN PENGERJAAN
Kerjakan bertahap dan pastikan setiap tahap berjalan sebelum lanjut: Tahap 1 selesai dan teruji, baru Tahap 2, lalu Tahap 3. Setelah tiap tahap, tunjukkan cara menjalankan dan mengetesnya.
