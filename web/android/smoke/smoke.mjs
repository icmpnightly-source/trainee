// Drives the NormativAI Android app on an emulator through its WebView:
// first start (server address), an athlete over the native HTTP client, the
// pull-up counter (camera + pose model inside the app) and GPS run tracking
// (native location service, positions from `adb emu geo fix`).
// Each part is checked on its own, so one failure does not hide the others.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { _android as android } from "playwright-core";

const OUT = process.env.OUT ?? "smoke-out";
const PKG = "uz.normativai.app";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const failures = [];
const check = (ok, what) => {
  log(`${ok ? "OK  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

log("looking for the device");
const [device] = await android.devices();
log("device:", device.model(), device.serial());
await device.shell(`am force-stop ${PKG}`);
await device.shell(`am start -n ${PKG}/.MainActivity`);
log("waiting for the app's WebView");
const webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
const page = await webview.page();
page.setDefaultTimeout(60_000);
log("connected to", page.url());
const errors = [];
page.on("console", (m) => {
  // Capacitor logs every native call; keep the output readable.
  if (["startGroupCollapsed", "endGroup", "dir"].includes(m.type())) return;
  log(`[console.${m.type()}] ${m.text()}`);
  // TensorFlow Lite prints its INFO lines on stderr, which arrives as console.error.
  if (m.type() === "error" && !/^INFO: /.test(m.text())) errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("crash", () => log("!! the WebView page crashed"));
const shot = async (name) => {
  try {
    fs.writeFileSync(`${OUT}/${name}.png`, await device.screenshot());
  } catch (e) {
    log("screenshot failed:", e.message);
  }
};

async function part(name, fn) {
  log(`---- ${name}`);
  try {
    await fn();
  } catch (e) {
    check(false, `${name}: ${e.message.split("\n")[0]}`);
    await shot(`fail-${name.replace(/\W+/g, "-")}`);
    try {
      log("page:", page.url(), "\n" + (await page.locator("body").innerText({ timeout: 5000 })).slice(0, 1500));
    } catch {
      log("page text unavailable");
    }
  }
}

let athleteUrl = null;

await part("first start", async () => {
  await page.waitForURL(/\/server$/);
  await shot("1-server");
  await page.locator("input").fill("10.0.2.2:8080");
  await page.getByRole("button", { name: "Ulanish" }).click();
  await page.locator(".ok-text").waitFor();
  check(true, "server reached through the native HTTP client");
  await shot("2-server-ok");
  await page.getByRole("button", { name: "Davom etish" }).click();
});

await part("athlete", async () => {
  await page.getByRole("button", { name: "+ Sportchi qo'shish" }).click();
  await page.getByLabel("Ism familiya").fill("Sinov Sportchi");
  await page.getByLabel("Tug'ilgan sana").fill("2004-05-01");
  await page.getByLabel("Bo'yi (sm)").fill("176");
  await page.getByLabel("Vazni (kg)").fill("70");
  await page.getByRole("button", { name: "Qo'shish" }).click();
  await page.waitForURL(/athletes\/\d+$/);
  athleteUrl = page.url();
  await page.locator("form.inline select").selectOption("pushup");
  await page.locator("form.inline input").fill("30");
  await page.locator("form.inline").getByRole("button", { name: "Qo'shish" }).click();
  await page.locator("td", { hasText: "30 marta" }).first().waitFor();
  check(true, "athlete created and result saved on the server");
  await shot("3-athlete");
});

await part("pull-up", async () => {
  await page.goto(athleteUrl ? `${athleteUrl}/pullup` : "https://localhost/pullup");
  // The emulator's GPU is software: the CPU path is the one that runs well there.
  await page.getByLabel("Hisoblash qurilmasi").selectOption("CPU");
  await page.getByRole("button", { name: "Boshlash", exact: true }).click();
  const status = page.locator("p.muted.small", { hasText: "Model:" });
  await status.waitFor({ timeout: 120_000 });
  log("model loaded:", await status.innerText());
  let fps = 0;
  for (let i = 0; i < 20 && fps === 0; i++) {
    await page.waitForTimeout(2000);
    const text = await status.innerText();
    fps = Number(text.match(/(\d+) kadr\/s/)?.[1] ?? 0);
    log("pull-up status:", text);
  }
  check(fps > 0, `pose model runs on camera frames in the app (${fps} frames/s)`);
  log("counter says:", await page.locator(".feedback").innerText());
  await shot("4-pullup");
  await page.getByRole("button", { name: "To'xtatish" }).click();
});

await part("run", async () => {
  await page.goto(athleteUrl ? `${athleteUrl}/run` : "https://localhost/run");
  const start = { lat: 41.3111, lon: 69.2797 };
  let i = 0;
  // 4 m north per second.
  const step = () => execFileSync("adb", ["emu", "geo", "fix", String(start.lon), String(start.lat + (i * 4) / 111_320)], { timeout: 10_000 });
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
  log("live distance:", live);
  await page.getByRole("button", { name: /To'xtatish/ }).click();
  await page.locator(".card h2", { hasText: "Natija" }).waitFor({ timeout: 60_000 });
  log("run result:", (await page.locator(".card .stats").last().innerText()).replace(/\n/g, " | "));
  const meters = Number(live.replace(/[^\d.]/g, "")) * (live.includes("km") ? 1000 : 1);
  check(meters > 60, `run recorded through the native location service (${live})`);
  await shot("6-run-result");
});

check(errors.length === 0, `no errors in the app console${errors.length ? `: ${errors.join(" / ")}` : ""}`);
await device.close().catch(() => {});
log(failures.length ? `${failures.length} check(s) failed:\n - ${failures.join("\n - ")}` : "All checks passed");
process.exit(failures.length ? 1 : 0);
