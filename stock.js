const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CENTRAL_REPO_OWNER = process.env.CENTRAL_REPO_OWNER;
const CENTRAL_REPO_NAME = process.env.CENTRAL_REPO_NAME || "nepse-central";
const CENTRAL_REPO_TOKEN = process.env.CENTRAL_REPO_TOKEN;

const URL = "https://www.nepalstock.com/market/main-chart/NEPSE";

async function main() {
  const nowNepal = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kathmandu" })
  );
  const hour = nowNepal.getHours();
  const minute = nowNepal.getMinutes();
  const market =
    (hour > 11 || (hour === 11 && minute >= 0)) &&
    (hour < 15 || (hour === 15 && minute === 0));
  if (!market) {
    console.log("❌ outside NEPSE hours");
    return;
  }
  const dateStr = nowNepal.toISOString().split("T")[0];
  const timestamp = nowNepal.toISOString();

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const tx = await page.evaluate(() => {
    const out = [];
    const rows = document.querySelectorAll("table tbody tr");
    rows.forEach((r) => {
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
  const filePath = path.join(dir, "stocktransaction.json");
  let arr = [];
  if (fs.existsSync(filePath)) {
    arr = JSON.parse(fs.readFileSync(filePath, "utf8"));
  }
  arr.push({ timestamp, transactions: tx });
  fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
  console.log("💾 stock saved", filePath);

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
    execSync('git commit -m "add stock snapshot"', { stdio: "ignore" });
    execSync("git push origin HEAD:main", { stdio: "ignore" });
    console.log("✅ pushed to central");
  } catch {
    console.log("⚠ nothing to commit / push failed");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
