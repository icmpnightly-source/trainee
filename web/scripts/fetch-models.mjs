// Puts the pose model and the MediaPipe runtime into public/, so the pull-up
// counter runs from this server alone, with no CDN at run time.
//   node scripts/fetch-models.mjs            lite + full models
//   POSE_MODELS=lite,full,heavy node scripts/fetch-models.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = path.join(web, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDst = path.join(web, "public", "mediapipe", "wasm");
const modelDir = path.join(web, "public", "models");
const BASE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker";

if (!fs.existsSync(wasmSrc)) {
  console.error("node_modules/@mediapipe/tasks-vision topilmadi: avval `npm install` qiling");
  process.exit(1);
}
// Only the classic build that FilesetResolver.forVisionTasks() loads by default
// (the *_module_* copy would add another 15 MB to the Android app).
fs.rmSync(wasmDst, { recursive: true, force: true });
fs.mkdirSync(wasmDst, { recursive: true });
for (const f of fs.readdirSync(wasmSrc).filter((f) => f.startsWith("vision_wasm_internal."))) fs.copyFileSync(path.join(wasmSrc, f), path.join(wasmDst, f));

fs.mkdirSync(modelDir, { recursive: true });
const wanted = (process.env.POSE_MODELS ?? "lite,full").split(",").map((s) => s.trim()).filter(Boolean);
for (const kind of wanted) {
  const file = path.join(modelDir, `pose_landmarker_${kind}.task`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) continue;
  const url = `${BASE}/pose_landmarker_${kind}/float16/latest/pose_landmarker_${kind}.task`;
  process.stdout.write(`Yuklanmoqda: ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`xato (HTTP ${res.status})`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file + ".part", buf);
  fs.renameSync(file + ".part", file);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
