import { expect, test } from "vitest";
import sharp from "sharp";
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
    await page
      .getByText("Panduan desain dan posisi bawaan", { exact: true })
      .click();
    expect(await page.locator("#certificate-guide svg").count()).toBe(1);
    const guideEvent = page.waitForEvent("download");
    await page.locator("#download-guide").click();
    expect((await guideEvent).suggestedFilename()).toBe(
      "panduan-background-sertifikat.svg",
    );
    await page.locator("#background-file").setInputFiles({
      name: "rusak.png",
      mimeType: "image/png",
      buffer: Buffer.from("not an image"),
    });
    await page.waitForFunction(
      () => !document.getElementById("background-error")?.hidden,
    );
    expect(await page.locator("#generate-button").isDisabled()).toBe(true);
    expect(await page.locator("#background-name").innerText()).toContain(
      "belum diterapkan",
    );
    await page.locator("#background-file").setInputFiles({
      name: "desain.png",
      mimeType: "image/png",
      buffer: await sharp({
        create: {
          width: 1600,
          height: 900,
          channels: 3,
          background: "#eef4e8",
        },
      })
        .png()
        .toBuffer(),
    });
    await page.waitForFunction(
      () =>
        document.getElementById("background-name")?.textContent ===
        "desain.png",
    );
    expect(await page.locator("#background-preview").isVisible()).toBe(true);
    expect(
      await page
        .locator("#background-file")
        .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
    ).toBe("desain.png");
    expect(await page.locator("#background-error").isVisible()).toBe(false);
    await page.locator("#certificate-settings summary").click();
    await page
      .getByRole("button", { name: "+ Tambah field", exact: true })
      .click();
    await page.getByLabel("Judul field 5", { exact: true }).fill("Instansi");
    await page.getByLabel("Judul field 5", { exact: true }).press("Tab");
    await page.getByLabel("Kiri (%) field 5", { exact: true }).fill("10");
    await page.getByLabel("Kiri (%) field 5", { exact: true }).press("Tab");
    await page.locator("#field-field1").fill("Universitas Contoh");
    const fieldBox = page.getByRole("button", {
      name: "Geser field Instansi",
      exact: true,
    });
    await fieldBox.focus();
    await page.keyboard.press("ArrowRight");
    expect(
      await page.getByLabel("Kiri (%) field 5", { exact: true }).inputValue(),
    ).toBe("11");
    expect(await page.locator("#field-field1").inputValue()).toBe(
      "Universitas Contoh",
    );
    const certificateRequest = page.waitForRequest((request) =>
      request.url().endsWith("/generate"),
    );
    await page.locator("#field-nama").fill("Dr. Éka Pratiwi, S.T.");
    await page.locator("#generate-button").click();
    const certificatePayload = (await certificateRequest).postDataJSON();
    expect(certificatePayload.certificateFields[4].label).toBe("Instansi");
    expect(certificatePayload.certificateFields[4].x).toBe(11);
    expect(certificatePayload.data.field1).toBe("Universitas Contoh");

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
    expect(await page.locator("#certificate-background").isVisible()).toBe(
      false,
    );
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
    const initialRows = await page.locator(".data-table tbody tr").count();
    expect(initialRows).toBeGreaterThan(0);
    await page.getByRole("button", { name: "+ Tambah baris" }).click();
    expect(await page.locator(".data-table tbody tr").count()).toBe(
      initialRows + 1,
    );
    await page.getByRole("button", { name: "Hapus baris" }).last().click();
    expect(await page.locator(".data-table tbody tr").count()).toBe(
      initialRows,
    );
    await page
      .getByRole("button", { name: "+ Tambah kolom", exact: true })
      .click();
    await page
      .getByLabel("Judul kolom 4", { exact: true })
      .fill("Harga satuan");
    await page.getByLabel("Judul kolom 4", { exact: true }).press("Tab");
    await page
      .getByLabel("Tipe kolom 4", { exact: true })
      .selectOption("number");
    expect(await page.locator(".data-table th").allTextContents()).toContain(
      "Harga satuan",
    );
    await page.locator('[data-path="items.0.kolom1"]').fill("12500");
    await page
      .getByRole("button", { name: "Naikkan kolom 4", exact: true })
      .click();
    expect(await page.locator(".data-table th").nth(2).innerText()).toBe(
      "Harga satuan",
    );
    expect(
      await page.locator('[data-path="items.0.kolom1"]').inputValue(),
    ).toBe("12500");
    await page
      .getByRole("button", { name: "Hapus kolom 4", exact: true })
      .click();
    expect(
      await page.locator(".data-table th").allTextContents(),
    ).not.toContain("Keterangan");
    const reportRequest = page.waitForRequest((request) =>
      request.url().endsWith("/generate"),
    );
    await page.locator("#generate-button").click();
    expect(
      (await reportRequest)
        .postDataJSON()
        .columns.map((column: { label: string }) => column.label),
    ).toEqual(["Nama", "Jumlah", "Harga satuan"]);
    await page.waitForFunction(
      () => !document.getElementById("preview-download")?.hidden,
    );
    await page.getByRole("button", { name: "Kembalikan kolom bawaan" }).click();
    expect(await page.locator(".data-table th").allTextContents()).toContain(
      "Keterangan",
    );
    await page.locator('[data-template="sertifikat"]').click();
    await page.waitForSelector("#field-nama");
    await page
      .getByRole("button", { name: "Kembalikan field bawaan", exact: true })
      .click();
    expect(await page.locator("#field-field1").count()).toBe(0);
    await page.locator("#reset-background").click();
    expect(await page.locator("#background-name").innerText()).toContain(
      "bawaan",
    );
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
