// Rasterize public/icons/*.svg into the PNG sizes the manifest and iOS need.
// Usage: npm run icons   (needs Playwright's Chromium)
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const dir = new URL("../public/icons/", import.meta.url);
const outputs = [
  ["icon.svg", "icon-192.png", 192],
  ["icon.svg", "icon-512.png", 512],
  ["icon-maskable.svg", "icon-maskable-512.png", 512],
  ["icon-maskable.svg", "apple-touch-icon.png", 180],
  ["icon.svg", "favicon-32.png", 32],
];
const executablePath = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage();
for (const [source, target, size] of outputs) {
  const svg = await readFile(new URL(source, dir), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await writeFile(new URL(target, dir), await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  console.log("wrote", target);
}
await browser.close();
