// Captures full-page screenshots of every screen in the running replica so critique
// agents can compare against the real MetaMask Portfolio. Usage: node scripts/screenshot.mjs [baseUrl]
// Drives the app through its mocked flow via ?screen= deep links (see src/App.tsx router).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] || "http://localhost:5273";
const OUT = new URL("../shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// Each screen is reachable via a deep link so we can snapshot without click-threading.
const SCREENS = [
  "login",
  "overview",
  "earn",
  "tranche",
  "amount",
  "crosschain",
  "review",
  "confirm",
  "confirm-cc",
  "success",
  "position",
  "activity",
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  for (const screen of SCREENS) {
    const url = `${BASE}/?screen=${screen}`;
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(400);
      // For the cross-chain confirm, click Confirm and let the Gateway bridging
      // stepper animate partway so it's visible in the static shot.
      if (screen === "confirm-cc") {
        await page.click('button:has-text("Confirm")');
        await page.waitForTimeout(1300);
      }
      const file = `${OUT}${vp.name}-${screen}.png`;
      await page.screenshot({ path: file, fullPage: true });
      console.log("captured", file);
    } catch (e) {
      console.error("FAILED", screen, e.message);
    }
  }
  await ctx.close();
}
await browser.close();
console.log("done ->", OUT);
