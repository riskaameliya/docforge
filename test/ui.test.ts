import { expect, test } from "vitest";
import { chromium } from "playwright";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, unzipSync } from "fflate";
import { createApp } from "../src/app.js";

test("UI and document API are public", async () => {
  const app = await createApp({
    logger: false,
  });
  try {
    for (const url of ["/", "/ui.js", "/ui.css", "/ui-font.ttf"]) {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("private-test-key");
    }
    expect((await app.inject("/templates")).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

test("browser: public access, form, PDF/PNG preview and download, import, batch and mobile", async () => {
  const app = await createApp({
    logger: false,
  });
  const browser = await chromium.launch();
  const root = await mkdtemp(path.join(os.tmpdir(), "docforge-ui-"));
  try {
    const base = await app.listen({ port: 0, host: "127.0.0.1" });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(base);
    await page.waitForSelector(".template-card");
    expect(await page.locator("#api-key").count()).toBe(0);
    expect(await page.locator(".template-card").count()).toBe(3);
    expect(await page.locator("#field-nama").inputValue()).toContain("Siti");
    await page.screenshot({
      path: "/tmp/docforge-ui-desktop.png",
      fullPage: true,
    });
    await page.locator("#field-nama").fill("Dr. Éka Pratiwi, S.T.");
    await page.locator("#generate-button").click();
    await page.waitForFunction(
      () => !document.getElementById("preview-download")?.hidden,
    );
    expect(await page.locator("#preview-body iframe").count()).toBe(1);
    const downloadEvent = page.waitForEvent("download");
    await page.locator("#download-link").click();
    const download = await downloadEvent;
    const pdfPath = path.join(root, "result.pdf");
    await download.saveAs(pdfPath);
    expect((await readFile(pdfPath)).subarray(0, 5).toString()).toBe("%PDF-");
    await page.locator("input[name=format][value=png]").check();
    await page.locator("#generate-button").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#preview-body img")
        ?.getAttribute("src")
        ?.startsWith("blob:"),
    );
    expect(await page.locator("#output-filename").innerText()).toBe(
      "sertifikat.png",
    );
    await page.locator('[data-template="surat-resmi"]').click();
    await page.waitForSelector("#field-penerima");
    await page.locator("#json-file").setInputFiles({
      name: "data.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          nomor: "001",
          tanggal: "2026-11-09",
          penerima: "Siti",
          isi: "Undangan kegiatan",
          penandatangan: "Budi",
        }),
      ),
    });
    await page.waitForFunction(
      () =>
        (document.getElementById("field-penerima") as HTMLInputElement)
          ?.value === "Siti",
    );
    await page.locator('[data-template="laporan"]').click();
    await page.waitForSelector(".data-table");
    expect(await page.locator(".data-table tbody tr").count()).toBe(80);
    await page.getByRole("button", { name: "+ Tambah baris" }).click();
    expect(await page.locator(".data-table tbody tr").count()).toBe(81);
    await page.getByRole("button", { name: "Hapus baris" }).last().click();
    expect(await page.locator(".data-table tbody tr").count()).toBe(80);
    await page.locator('[data-template="sertifikat"]').click();
    await page.waitForSelector("#field-nama");
    await page.locator("#field-nama").fill("");
    await page.locator("#mode-batch").click();
    const zip = zipSync({ "report.json": Buffer.from('{"succeeded":1}') });
    await page.route("**/generate/batch", async (route) => {
      expect(route.request().headers()["x-api-key"]).toBeUndefined();
      expect(route.request().postDataJSON().data).toHaveLength(2);
      await route.fulfill({
        contentType: "application/zip",
        body: Buffer.from(zip),
      });
    });
    await page.locator("#json-file").setInputFiles({
      name: "batch.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([{ nama: "Siti" }, {}])),
    });
    await page.waitForFunction(
      () => document.getElementById("batch-count")?.textContent === "2 dokumen",
    );
    await page.locator("#generate-button").click();
    await page.waitForFunction(
      () =>
        document.getElementById("output-filename")?.textContent === "batch.zip",
    );
    const zipEvent = page.waitForEvent("download");
    await page.locator("#download-link").click();
    const zipDownload = await zipEvent;
    const zipPath = path.join(root, "result.zip");
    await zipDownload.saveAs(zipPath);
    expect(Object.keys(unzipSync(await readFile(zipPath)))).toContain(
      "report.json",
    );
    await page.locator("#mode-single").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/docforge-ui-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.reload();
    await page.waitForSelector(".template-card");
    expect(await page.locator("#api-key").count()).toBe(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await browser.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
