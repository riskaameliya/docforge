# DocForge — Document Generator

Adding a new document type only requires a new template folder—there is no need to rewrite the application's layout code. The service accepts JSON, validates it against the template schema, and returns a downloadable PDF or PNG.

## Use in Your Browser

Run `npm run dev`, then open **http://localhost:3000**. No login or API key is required. You can generate documents entirely through the UI, without Postman or curl:

1. Choose a certificate, formal letter, or report template.
2. Fill out the form. Report tables support adding and removing rows. The **Sample Data** button restores the built-in example.
3. Select PDF or PNG, click **Generate Document**, preview the result, and download it.

**Import JSON** accepts either an object for a single document or an array of objects to switch to **Batch** mode. Batch mode generates multiple documents and provides a ZIP file with a failure report, without Redis.

Document data is sent to the server, processed temporarily in memory, and returned directly to the browser. Generated files are not archived or assigned public URLs, and responses use `Cache-Control: no-store`. Batch ZIP files are created in memory, with limits of 64 MB and 100 items (`BATCH_LIMIT`). Document contents are not recorded in application logs. The converter processes local files in the browser.

Generation endpoints are limited to 60 requests per IP per minute per process. The application uses the direct connection address; when using a reverse proxy, configure per-user IP rate limiting at the proxy. Use HTTPS for public deployments. Built-in templates and sample data are public, so do not place users' personal information in template folders.

Run `npm run test:ui` to test the login-free browser experience, forms, previews/downloads, JSON import, batch processing, and mobile layout.

## Stage 1 — HTML

Requires Node.js 22.13+, npm, and Chromium. Run:

```sh
npm ci
npx playwright install chromium
cp .env.example .env
npm run dev
npm run test:stage1
npm run build
```

`npm run dev` and `npm start` automatically load `.env` from the working directory before creating the application. Variables already set in the shell or Docker take precedence. The `.env` file is optional when configuration is supplied through the environment.

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

Each template contains `templates/<id>/template.html`, `schema.json`, `sample-data.json`, and optionally `config.json`. IDs may contain only letters, numbers, `_`, and `-`. A schema has the form `{"fields":{"nama":{"type":"string","required":true}}}`. Supported types are string, number, date (a valid ISO YYYY-MM-DD date), and array; arrays of objects use `items: {fields: {...}}`. Optional fields may be omitted, while required string fields cannot be empty. Unknown keys are removed. Date fields are not automatically converted.

Handlebars supports `{{nama}}`, `{{#each items}}...{{/each}}`, and `{{#if catatan}}...{{/if}}`. Use regular escaped placeholders for user-provided data and conditionals for optional fields. HTML and template files must be managed by trusted administrators, not uploaded by API clients.

Example configuration: `{"type":"html","size":"A4","orientation":"portrait","margin":15}`. Supported sizes are A4, A5, and custom. Custom sizes require `width` and `height` in **mm**, before orientation is applied. Margins are also in mm. PNG output is one long image containing all content; PDF output supports pagination and repeated table headers. Template assets in `assets/` are accessible through paths such as `/assets/logo.svg`; global fonts in `fonts/` can be loaded through `/fonts/MyFont.ttf` and `@font-face`.

Chromium is reused across renders, with a separate browser context per render and a concurrency limit (`RENDER_CONCURRENCY`, default 2; maximum queue size 100). Template JavaScript is disabled, service workers are blocked, CSP disallows scripts and frames, and all network requests are denied except requests to an internal origin serving assets and fonts with realpath checks. No network server runs at that internal origin. Routing follows the [Playwright documentation](https://playwright.dev/docs/network).

Errors follow a consistent format: `{"error":{"code":422,"message":"Data tidak sesuai schema","fields":[{"field":"items.0.jumlah","message":"..."}]}}`. Status codes include 404 for missing templates, 413 for oversized request bodies, 422 for invalid input, 503 for a full queue, and 500 for internal errors without exposing sensitive details. Pino logs server errors. All endpoints are public without authentication; generation endpoints return 429 when rate limits are exceeded.

## Stage 2 — Overlay

```sh
npm run test:stage2
npm run dev
curl localhost:3000/generate \
  -H 'Content-Type: application/json' \
  -d '{"template":"sertifikat","format":"pdf","data":{"nama":"Dr. Siti Nuraini, S.T., M.Eng.","kegiatan":"Pelatihan Digital","tanggal":"2026-11-09","nomor":"CERT-001"}}' -o sertifikat.pdf
# Change the format to png and the output filename to sertifikat.png for an image.
```

Noto Sans fonts and their licenses are included and used by the letter and certificate templates.

Overlay templates use `config.json`, such as `{"type":"overlay","background":"background.pdf"}`, together with `schema.json`, `sample-data.json`, and `fields.json`. The background can be a PDF or PNG. Page dimensions follow the background, and HTML page settings do not apply. Example fields:

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

The coordinate origin is the **top-left corner**, with y increasing downward. For `percent`, x and width are relative to page width, while y and height are relative to page height, all within 0–100. `pt` represents 1/72 inch. Font sizes are always in points. PNGs are treated as 96 dpi (96 px = 72 pt). `page` numbering starts at 1. Text boxes must remain within page boundaries. The default font is Helvetica. For Unicode characters outside Latin, place a TTF file in `fonts/` and set `font` to its filename. Auto-shrinking stops at `minFontSize`; text that still does not fit returns 422 instead of being silently clipped. Wrapping supports newlines and line breaks, including very long words.

pdf-lib preserves the original PDF design and adds precisely positioned text. PDF.js and @napi-rs/canvas rasterize the resulting PDF to PNG; sharp reads the PNG background dimensions and encodes the output. Multi-page PDFs remain intact in PDF output, while PNG output includes **only the first page**. Overlay mode is best for existing certificate and form designs; HTML mode is better for tables and dynamically flowing content. Rotated PDF backgrounds should be normalized to 0° rotation before use.

## Batch Processing and Deployment

```sh
docker compose up --build -d
npm test
npm run build
```

`POST /generate/batch` accepts `{template, format, data: [...], filenameField?}` and immediately returns a ZIP file (HTTP 200), without a Redis queue, disk archives, or a `/jobs` endpoint. The ZIP includes successfully generated documents and `report.json` containing `{total,succeeded,failures}`. Failure indices are zero-based. Filenames are sanitized and numbered. Only per-document validation errors are recorded as partial failures; service-level errors abort the entire batch.

One batch is processed at a time, with up to two additional batches waiting per process. The batch time limit is checked between documents (120 seconds), and each document render is limited to 30 seconds. The browser must remain open until the download is ready. Data cannot be recovered after a request completes or fails.

Legacy `.env` settings such as `API_KEY`, `REDIS_URL`, and `OUTPUT_DIR` are no longer used. Archives and Redis volumes from older versions are not automatically removed; these changes apply to new processing operations.

In Docker, Chromium runs as the `node` user with its browser sandbox disabled for container compatibility. Render isolation still blocks JavaScript and external network access and checks local file access. Place HTTPS and a reverse proxy in front of public deployments.

## Convert PDF to a TypeScript Template

Open **http://localhost:3000/converter** or select **PDF to Code**. Select or drag in a PDF (up to 15 MB and 20 pages). The file is processed locally in the browser and is not uploaded to the server. Select text in the PDF, assign a variable name such as `nomorSurat`, and choose its type and sample value. The **Text to Replace** field supports replacing part of a text segment: `Nomor: 001/2026` can become `Nomor: {{nomorSurat}}`. Mapping operates on detected text segments; each segment supports one replacement at the first occurrence of the selected substring. The same variable can be reused across multiple segments when its type, required status, and sample value match.

Enter a function name, such as `TemplateSuratPemanggilan`. The results panel provides an HTML preview, TypeScript/HTML code, schema and sample data, and usage examples. Download a standalone `.ts` file or a ZIP package containing:

- `<NamaFungsi>.ts`: a standalone, typed function that returns an HTML string with dynamic data escaped.
- `template.html`, `schema.json`, `sample-data.json`, and `config.json`: ready to copy into `templates/<id>/` and use through `/generate` or the UI after refreshing the template list.
- `example.ts` and `README.md`: integration examples for your application.

Example after mapping the `nomorSurat` field:

```ts
import { TemplateSuratPemanggilan } from "./TemplateSuratPemanggilan";

const html = TemplateSuratPemanggilan({ nomorSurat: "002/BPSDM/2026" });
// Use the HTML string with your application's PDF renderer.
```

The converter preserves PDF page coordinates. Graphics and images become embedded PNGs, while readable text becomes HTML elements. Review the resulting fonts, text colors, and positioning. Source fonts can be replaced with application fonts in the exported code. Scanned PDFs are not processed with OCR. Use the Certificate field editor or custom Formal Letter mode to add text over scanned backgrounds. Semantic table structures, loops such as `peserta.map(...)`, entity imports, date formatting, and application-specific data relationships cannot be inferred from a PDF; add that logic to the exported code. For long tables that need to flow across pages, use an HTML template with a loop. When PDF pages have different sizes, CSS preserves each page's dimensions, while the DocForge renderer configuration follows the first page.

Run `npm run test:converter` to test substring mapping, HTML/code escaping, strict TypeScript, multi-page PDFs, separation of graphics and text, installable template ZIPs, and desktop/mobile layouts.

## Custom Certificate Backgrounds

In the **Certificate** template, select a PNG or JPG up to 5 MB and 16 megapixels. Use A4 landscape (297 × 210 mm), such as 1684 × 1190 px or 3508 × 2480 px. The image fills one 842 × 595 pt PDF page; images with different aspect ratios are fitted without cropping, leaving white space. Use an A4 aspect ratio to align text areas with the guide. PNG output is rasterized at 96 dpi.

Open the **Certificate Design Guide** in the form and download the guide SVG. Leave the following areas clear, measured from the top-left corner:

| Field | Left | Top | Width | Height |
| ----- | ---- | --- | ----- | ------ |
| Name | 12% | 43% | 76% | 12% |
| Activity | 15% | 63% | 70% | 10% |
| Date | 30% | 75% | 40% | 6% |
| Number | 45 pt | 535 pt | 300 pt | 25 pt |

The title, logo, border, signature, and fixed labels must already be part of the image. Do not include participant data or guide boxes in the final design. Use a light background in text areas. Field positions can be adjusted in the form; preview the result before printing.

The `/generate` and `/generate/batch` APIs accept an optional `background` property containing a `data:image/png;base64,...` or `data:image/jpeg;base64,...` URI, specifically for the `sertifikat` template. The generation request body is limited to 8 MiB to accommodate base64 images. Backgrounds are validated and normalized in memory without writing to disk. A single background is shared across all documents in a batch. Built-in templates remain unchanged, and other users do not receive the uploaded image. The **Use Default Design** button clears the selected background for that tab.

## Custom Report Columns

Select **Report**, then use the **Report Columns** panel to add, remove, rename, change types, mark fields as required, and reorder columns with arrow buttons. A report can have 1–12 columns. The default columns are Name, Quantity, and Notes. **Restore Default Columns** resets the configuration. Removing a column removes its values from the form; changing its type may clear incompatible values.

Settings apply to PDF/PNG output and all batch documents in that tab without being stored on the server. When importing JSON, populate `items` using the keys shown in the columns panel. The report title and date remain available.

The `/generate` and `/generate/batch` APIs accept optional `columns`, specifically for the `laporan` template:

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

An example row is `{"produk":"Buku","harga":12500}` inside `items`. Supported types are `string`, `number`, and `date` (YYYY-MM-DD). Keys must be unique, start with a letter, and contain only letters, numbers, or underscores (maximum 40 characters). If `columns` is omitted, the built-in columns are used. Labels and cell contents are escaped during rendering.

## Custom Certificate Fields and Positions

Open **Edit Certificate Design**. Add or remove fields (1–20), change labels, data types (text/number/date), required status, font size, color, and alignment. Move boxes on the background map using a mouse, touch, or arrow keys (1% per step). Left/top positions and width/height use percentages of the A4 page, and boxes cannot extend beyond the page. The map shows field areas; check the PDF/PNG output for actual typography. Without an uploaded image, the canvas shows the built-in certificate background as a positioning reference.

Field labels are input titles, not printed text. Fixed elements embedded in the default background cannot be removed through field settings; upload your own background to replace them. **Restore Default Fields** resets the field configuration. Removing a field removes its value from the form; changing its type may clear incompatible values.

The generation and batch APIs accept optional `certificateFields`, specifically for the `sertifikat` template, for example:

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

Example data is `{"instansi":"Universitas Contoh"}`. Fonts use the built-in Noto Sans with wrapping and auto-shrinking, with a minimum size of 6 pt. Required fields are validated against the data. In batch mode, the same settings apply to every document. Settings exist only in the browser tab and request; they do not modify templates or store data on the server.

## Letters with Custom Letterheads or Templates

In **Formal Letter**, select **Edit Letter Design** to open the editor and enable a custom layout. Custom mode uses A4 portrait (595 × 842 pt). Upload a PNG/JPG or single-page PDF up to 5 MB. A short letterhead image is placed at the top of the page; a full-page template is fitted without cropping. Word documents must first be exported to PDF.

PDFs are rasterized locally in the browser before being sent. Multi-page and password-protected PDFs are rejected with an upload message. Fixed content, letterheads, logos, and signatures already embedded in the image are preserved. Dynamic fields are added on top; remove sample text from the template first to avoid overlapping content.

Open **Edit Letter Design** to move and resize fields, add or remove fields, and configure fonts, colors, and alignment. Field labels are input titles, not printed text. Without an uploaded background, custom mode uses a blank white page. Letter and certificate settings are kept separately in the browser tab and do not modify server templates.

Custom mode produces a single page with fixed text areas and auto-shrinking; content that still does not fit at the minimum font size is rejected. For long letters that require flowing text and automatic page breaks, disable custom mode to return to the default HTML layout.

The `/generate` and `/generate/batch` APIs accept `letterFields` for `surat-resmi`, with the same structure as `certificateFields`, plus an optional PNG/JPEG data URI in `background`. If only a background is provided, the default letter fields are used. Results are returned directly as PDF/PNG/ZIP without being archived on the server.

## Single-Screen Design Editor

For certificates, select **Edit Certificate Design**. For letters, select **Edit Letter Design** to open the same editor in A4 portrait format. Custom mode is enabled when the editor opens; turn off **Use Custom Single-Page Layout** inside the editor to return to the default layout. The editor displays a large canvas with a properties panel beside it. Select a field directly on the canvas or from the field list; only the selected field's properties are shown. Drag a box to move it, drag its bottom-right corner to resize it, or use arrow keys to move it and Shift + arrow keys to resize it.

Background upload and reset controls are available in the toolbar. The default certificate also appears on the canvas as a reference. The canvas remains visible while scrolling through properties or guidance in the side panel. On mobile, the canvas appears above the properties panel and adjusts its height to the screen. Changes are applied directly to the form; click **Done** or press Escape to close the editor. Check the PDF/PNG output after adjusting the design. The editor is part of the form, with no separate editor page or server-side design storage.
