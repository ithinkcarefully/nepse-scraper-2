const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

const FORCE_RUN = process.env.FORCE_RUN === "true";
const URL = "https://www.nepalstock.com/market/main-chart/NEPSE";

async function main() {
  const nowNepal = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" })
  );
  const hour = nowNepal.getHours();
  const minute = nowNepal.getMinutes();

  const inMarketHours =
    (hour > 11 || (hour === 11 && minute >= 0)) &&
    (hour < 15 || (hour === 15 && minute === 0));

  if (!FORCE_RUN && !inMarketHours) {
    console.log("⏱ Outside NEPSE hours");
    return;
  }

  const dateStr = nowNepal.toISOString().split("T")[0];
  const timestamp = nowNepal.toISOString();
  console.log("📊 Stock scraper started at", timestamp);

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
    });

    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.5",
    });

    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2500);

    const tx = await page.evaluate(() => {
      const out = [];
      const rows = document.querySelectorAll("table tbody tr");
      rows.forEach((r, idx) => {
        if (idx > 20) return;
        const tds = r.querySelectorAll("td");
        if (tds.length >= 5) {
          out.push({
            symbol: tds[0].textContent.trim(),
            ltp: tds[1].textContent.trim(),
            volume: tds[2].textContent.trim(),
            turnover: tds[3].textContent.trim(),
            change: tds[4].textContent.trim(),
          });
        }
      });
      return out;
    });

    await browser.close();

    const dir = path.join("data", "raw", dateStr);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "stocktransaction.json");
    const arr = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    arr.push({ timestamp, transactions: tx });
    fs.writeFileSync(file, JSON.stringify(arr, null, 2));
    
    console.log("✅ Stock data saved");
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("❌ Fatal Error:", e.message);
  process.exit(1);
});
