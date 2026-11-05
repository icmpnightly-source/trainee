// Drives the NormativAI Android app on an emulator through its WebView:
// first start (server address), an athlete over the native HTTP client, the
// pull-up counter (camera + pose model inside the app) and GPS run tracking
// (native location service, positions from `adb emu geo fix`).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { _android as android } from "playwright-core";

const OUT = process.env.OUT ?? "smoke-out";
const PKG = "uz.normativai.app";
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const [device] = await android.devices();
console.log("device:", device.model(), device.serial());
await device.shell(`am force-stop ${PKG}`);
await device.shell(`am start -n ${PKG}/.MainActivity`);
const webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
const page = await webview.page();
page.setDefaultTimeout(60_000);
const errors = [];
page.on("console", (m) => {
  console.log(`[console.${m.type()}] ${m.text()}`);
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (name) => fs.writeFileSync(`${OUT}/${name}.png`, await device.screenshot());

// 1. First start: the app asks for its server.
await page.waitForURL(/\/server$/);
await shot("1-server");
await page.locator("input").fill("10.0.2.2:8080");
await page.getByRole("button", { name: "Ulanish" }).click();
await page.locator(".ok-text").waitFor();
check(true, "server reached through the native HTTP client");
await shot("2-server-ok");
await page.getByRole("button", { name: "Davom etish" }).click();

// 2. An athlete and a result.
await page.getByRole("button", { name: "+ Sportchi qo'shish" }).click();
await page.getByLabel("Ism familiya").fill("Sinov Sportchi");
await page.getByLabel("Tug'ilgan sana").fill("2004-05-01");
await page.getByLabel("Bo'yi (sm)").fill("176");
await page.getByLabel("Vazni (kg)").fill("70");
await page.getByRole("button", { name: "Qo'shish" }).click();
await page.waitForURL(/athletes\/\d+$/);
await page.locator("form.inline select").selectOption("pushup");
await page.locator("form.inline input").fill("30");
await page.locator("form.inline").getByRole("button", { name: "Qo'shish" }).click();
await page.locator("td", { hasText: "30 marta" }).first().waitFor();
check(true, "athlete created and result saved on the server");
await shot("3-athlete");
const athleteUrl = page.url();

// 3. Pull-up counter: emulator camera into the pose model running in the app.
await page.getByRole("link", { name: /Turnik/ }).click();
await page.getByRole("button", { name: "Boshlash", exact: true }).click();
const status = page.locator("p.muted.small", { hasText: "Model:" });
await status.waitFor({ timeout: 120_000 });
await page.waitForTimeout(8000);
const statusText = await status.innerText();
console.log("pull-up status:", statusText);
const fps = Number(statusText.match(/(\d+) kadr/)?.[1] ?? 0);
check(fps > 0, `pose model runs on camera frames in the app (${fps} frames/s)`);
await shot("4-pullup");
await page.getByRole("button", { name: "To'xtatish" }).click();

// 4. Run tracking: positions fed to the emulator's GPS.
await page.goto(athleteUrl);
await page.getByRole("link", { name: /Yugurish/ }).click();
const geo = (lat, lon) => execFileSync("adb", ["emu", "geo", "fix", String(lon), String(lat)]);
const start = { lat: 41.3111, lon: 69.2797 };
let i = 0;
const step = () => geo(start.lat + (i * 4) / 111_320, start.lon); // 4 m north per second
step();
await page.locator(".badge", { hasText: "GPS ±" }).waitFor({ timeout: 90_000 });
check(true, "native GPS gives a position");
await page.getByRole("button", { name: /Start/ }).click();
for (i = 1; i <= 40; i++) {
  step();
  await page.waitForTimeout(1000);
}
await shot("5-run-live");
const live = await page.locator(".stats.run > div").nth(1).locator("b").innerText();
console.log("live distance:", live);
await page.getByRole("button", { name: /To'xtatish/ }).click();
await page.locator(".card h2", { hasText: "Natija" }).waitFor({ timeout: 60_000 });
const result = (await page.locator(".card .stats").last().innerText()).replace(/\n/g, " | ");
console.log("run result:", result);
const meters = Number(live.replace(/[^\d.]/g, "")) * (live.includes("km") ? 1000 : 1);
check(meters > 60, `run recorded through the native location service (${live})`);
await shot("6-run-result");

check(errors.length === 0, `no errors in the app console${errors.length ? `: ${errors.join(" / ")}` : ""}`);
await device.close();
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
