import { afterAll, expect, test } from "vitest";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { Renderer } from "../src/render.js";
import { createApp } from "../src/app.js";
const r = new Renderer();
afterAll(() => r.close());
for (const id of ["surat-resmi", "laporan"])
  for (const format of ["pdf", "png"] as const)
    test(`${id} ${format}`, async () => {
      const t = await r.templates.load(id);
      const b = await r.generate(id, format, t.sample);
      if (format === "pdf") {
        expect(b.subarray(0, 5).toString()).toBe("%PDF-");
        const count = (await PDFDocument.load(b)).getPageCount();
        if (id === "laporan") expect(count).toBeGreaterThan(1);
        else expect(count).toBe(1);
      } else {
        expect((await sharp(b).metadata()).format).toBe("png");
      }
    }, 30000);
test("long table spans pages; long Unicode text and empty optional fields", async () => {
  const b = await r.generate("laporan", "pdf", {
    judul: "Dr. Éka Pratiwi, S.T., M.Sc. " + "panjang ".repeat(30),
    tanggal: "2026-11-09",
    items: Array.from({ length: 130 }, () => ({
      nama: "Barang ".repeat(12),
      jumlah: 1,
      keterangan: "",
    })),
  });
  expect((await PDFDocument.load(b)).getPageCount()).toBeGreaterThan(2);
}, 30000);
test("Public API, validation, download and path traversal", async () => {
  const app = await createApp({ renderer: r, logger: false });
  expect((await app.inject("/health")).statusCode).toBe(200);
  expect((await app.inject("/templates")).statusCode).toBe(200);
  const headers = { "x-api-key": "test" };
  expect((await app.inject({ url: "/templates", headers })).statusCode).toBe(
    200,
  );
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/generate",
        headers,
        payload: { template: "surat-resmi", format: "pdf", data: {} },
      })
    ).statusCode,
  ).toBe(422);
  const t = await r.templates.load("surat-resmi");
  const res = await app.inject({
    method: "POST",
    url: "/generate",
    headers,
    payload: { template: t.id, format: "pdf", data: t.sample },
  });
  expect(res.headers["content-disposition"]).toContain("attachment");
  expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  await app.close();
}, 30000);

test("render blocks JavaScript and network, supports custom page sizes", async () => {
  const { createServer } = await import("node:http");
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end("unexpected");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as import("node:net").AddressInfo;
    const t = await r.templates.load("laporan");
    t.config = {
      ...t.config,
      size: "custom",
      width: 100,
      height: 150,
      margin: 0,
    };
    const bytes = await r.renderHtml(
      `<style>@import url('http://127.0.0.1:${address.port}/style');</style><h1>Allowed</h1><script>document.body.innerHTML='HACKED'</script><img src="http://127.0.0.1:${address.port}/secret"><img src="file:///etc/passwd">`,
      t,
      "pdf",
    );
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
    });
    try {
      const doc = await task.promise;
      const p = await doc.getPage(1);
      const content = await p.getTextContent();
      const text = content.items.map((i: any) => i.str ?? "").join(" ");
      expect(text).toContain("Allowed");
      expect(text).not.toContain("HACKED");
      expect(p.getViewport({ scale: 1 }).width).toBeCloseTo(
        (100 * 72) / 25.4,
        0,
      );
    } finally {
      await task.destroy();
    }
    expect(requests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}, 30000);

test("local assets reject traversal and symlink escapes", async () => {
  const { mkdtemp, writeFile, symlink, mkdir, rm } =
    await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(os.tmpdir(), "docforge-assets-"));
  try {
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "secret.txt"), "secret");
    await symlink(
      path.join(root, "secret.txt"),
      path.join(root, "assets", "escape.txt"),
    );
    await expect(
      r.templates.local(path.join(root, "assets"), "../secret.txt"),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      r.templates.local(path.join(root, "assets"), "escape.txt"),
    ).rejects.toMatchObject({ statusCode: 403 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
