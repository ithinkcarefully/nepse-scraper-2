const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CENTRAL_REPO_OWNER = process.env.CENTRAL_REPO_OWNER;
const CENTRAL_REPO_NAME = process.env.CENTRAL_REPO_NAME || "nepse-central";
const CENTRAL_REPO_TOKEN = process.env.CENTRAL_REPO_TOKEN;

const URL = "https://www.nepalstock.com/market/sector";

async function main() {
  const nowNepal = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" })
  );
  const hour = nowNepal.getHours();
  const minute = nowNepal.getMinutes();
  const forceRun = process.env.FORCE_RUN === "true";
  const market = forceRun || (
    (hour > 11 || (hour === 11 && minute >= 0)) &&
    (hour < 15 || (hour === 15 && minute === 0))
  );
  if (!market) {
    console.log("Outside NEPSE hours");
    return;
  }

  const dateStr = nowNepal.toISOString().split("T")[0];
  const timestamp = nowNepal.toISOString();

  console.log("sector scraper at", timestamp);

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
    });

    const context = await browser.createBrowserContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    });

    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.5",
      "DNT": "1",
      "Connection": "keep-alive"
    });

    let retries = 3;
    let loaded = false;
    while (retries > 0 && !loaded) {
      try {
        await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
        loaded = true;
      } catch (e) {
        retries--;
        console.log(`⚠ Retry... (${retries} left)`);
        if (retries > 0) await page.waitForTimeout(5000);
        else throw e;
      }
    }

    await page.waitForTimeout(2000);

    const sectors = await page.evaluate(() => {
      const out = [];
      const rows = document.querySelectorAll("table tbody tr");
      rows.forEach((r, idx) => {
        if (idx > 20) return;
        const tds = r.querySelectorAll("td");
        if (tds.length >= 5) {
          out.push({
            sector: tds[0].textContent.trim(),
            turnover: tds[1].textContent.trim(),
            volume: tds[2].textContent.trim(),
            transactions: tds[3].textContent.trim(),
            companies: tds[4].textContent.trim(),
          });
        }
      });
      return out;
    });

    console.log("✅ Scraped", sectors.length, "sectors");

    await context.close();
    await browser.close();

    const dir = path.join("data", "raw", dateStr);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, "sectortransaction.json");
    let arr = [];
    if (fs.existsSync(filePath)) {
      arr = JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    arr.push({ timestamp, sectors });
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
    console.log("💾 sector saved");

    if (!CENTRAL_REPO_TOKEN || !CENTRAL_REPO_OWNER) return;
    try {
      execSync("git init", { stdio: "ignore" });
      execSync(
        `git remote add origin https://${CENTRAL_REPO_OWNER}:${CENTRAL_REPO_TOKEN}@github.com/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}.git`,
        { stdio: "ignore" }
      );
    } catch {}
    execSync('git config user.email "action@github.com"');
    execSync('git config user.name "GitHub Action"');
    execSync("git add data", { stdio: "ignore" });
    try {
      execSync('git commit -m "add sector"', { stdio: "ignore" });
      execSync("git push origin HEAD:main", { stdio: "ignore" });
      console.log("✅ pushed");
    } catch {
      console.log("⚠ push failed");
    }
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();
