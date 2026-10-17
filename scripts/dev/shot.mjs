// Dev helper: open the app in Chromium, run optional steps, screenshot.
import { chromium } from "playwright";
const [url = "http://127.0.0.1:5173/", out = "shot.png", stepsFile] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
page.on("pageerror", e => console.log("PAGEERROR", e.message));
page.on("console", m => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text()); });
await page.goto(url);
await page.waitForTimeout(2500);
if (stepsFile) { const steps = (await import(stepsFile)).default; await steps(page); }
await page.screenshot({ path: out, fullPage: false });
await browser.close();
