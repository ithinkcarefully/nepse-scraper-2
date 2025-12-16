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

  const market =
    forceRun ||
    ((hour > 11 || (hour === 11 && minute >= 0)) &&
      (hour < 15 || (hour === 15 && minute === 0)));

  if (!market) return console.log("⏱ Outside market hours");

  const dateStr = nowNepal.toISOString().split("T")[0];
  const timestamp = nowNepal.toISOString();

  let browser;

  try {
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const sectors = await page.evaluate(() => {
      return [...document.querySelectorAll("table tbody tr")].map(r => {
        const t = r.querySelectorAll("td");
        return t.length >= 5
          ? {
              sector: t[0].textContent.trim(),
              turnover: t[1].textContent.trim(),
              volume: t[2].textContent.trim(),
              transactions: t[3].textContent.trim(),
              companies: t[4].textContent.trim()
            }
          : null;
      }).filter(Boolean);
    });

    await browser.close();

    const dir = path.join("data", "raw", dateStr);
    fs.mkdirSync(dir, { recursive: true });

    const file = path.join(dir, "sectortransaction.json");
    const arr = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : [];

    arr.push({ timestamp, sectors });
    fs.writeFileSync(file, JSON.stringify(arr, null, 2));

    console.log("💾 Sector data saved");

    if (!CENTRAL_REPO_OWNER || !CENTRAL_REPO_TOKEN) return;

    try {
      execSync("git init", { stdio: "ignore" });
      execSync(
        `git remote add origin https://${CENTRAL_REPO_OWNER}:${CENTRAL_REPO_TOKEN}@github.com/${CENTRAL_REPO_OWNER}/${CENTRAL_REPO_NAME}.git`,
        { stdio: "ignore" }
      );
    } catch {}

    execSync("git add data");

    try {
      execSync('git commit -m "add sector"', { stdio: "pipe" });
      console.log("✅ commit done");
    } catch (e) {
      console.log("⚠ commit failed:", e.message);
    }

    try {
      execSync("git push origin HEAD:main", { stdio: "pipe" });
      console.log("✅ pushed");
    } catch (e) {
      console.log("❌ push failed:", e.message);
    }
  } catch (e) {
    console.error("❌ Error:", e.message);
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

main();
