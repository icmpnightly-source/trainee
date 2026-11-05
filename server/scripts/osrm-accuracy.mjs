// How accurate the run results are on your map: simulated runs (3.5 m/s) on
// loop and out-and-back courses around START, with several GPS noise models,
// compared with the true distance and the true 1 km time.
//   OSRM_URL=http://127.0.0.1:5000 START=41.3111,69.2797 node scripts/osrm-accuracy.mjs
import { haversine, destination, lineLength } from "../../shared/geo.js";
import { createOsrm } from "../src/osrm.mjs";
import { analyzeRun } from "../src/runs.mjs";
const osrm = createOsrm({ baseUrl: process.env.OSRM_URL ?? "http://127.0.0.1:5000" });
const [lat0, lon0] = (process.env.START ?? "41.3111,69.2797").split(",").map(Number);
const START = { lat: lat0, lon: lon0 };
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function sample(coords, speed) {
  const line = coords.map(([lon, lat]) => ({ lat, lon })); const out = []; let carry = 0;
  for (let i = 1; i < line.length; i++) { const seg = haversine(line[i-1], line[i]); let d = carry;
    for (; d < seg; d += speed) { const f = d / seg; out.push({ lat: line[i-1].lat + (line[i].lat-line[i-1].lat)*f, lon: line[i-1].lon + (line[i].lon-line[i-1].lon)*f }); }
    carry = d - seg; }
  return out;
}
function noisy(truth, model, sigma) {
  let ex = 0, ey = 0; const rho = 0.9;
  return truth.map((p, i) => {
    if (model === "iid") { ex = gauss() * sigma; ey = gauss() * sigma; }
    else { ex = rho * ex + Math.sqrt(1 - rho * rho) * gauss() * sigma; ey = rho * ey + Math.sqrt(1 - rho * rho) * gauss() * sigma; }
    const d = Math.hypot(ex, ey); const b = (Math.atan2(ex, ey) * 180) / Math.PI;
    return { ...destination(p, b, d), t: 1_700_000_000_000 + i * 1000, acc: Math.max(4, sigma * 1.5) };
  });
}
const rows = [];
const courses = [];
for (const bearing of [0, 120, 240]) {
  const loop = await osrm.loop(START, 2000, bearing);
  courses.push([`loop${bearing}`, [...loop.coordinates, ...loop.coordinates.slice(1)]]);
}
// Out and back: 700 m out, U-turn, back.
const out = await osrm.route([START, destination(START, 60, 600)]);
courses.push(["out-back", [...out.coordinates, ...out.coordinates.slice().reverse().slice(1)]]);
for (const [bearing, coords] of courses) {
  const truth = sample(coords, 3.5);
  const trueLen = lineLength(truth.map((p) => [p.lon, p.lat]));
  for (const [model, sigma] of [["iid", 1], ["iid", 4], ["ar1", 3], ["ar1", 6], ["ar1", 10]]) {
    const pts = noisy(truth, model, sigma);
    const a = await analyzeRun({ points: pts, targetDistance: 1000, osrm });
    const trueT = 1000 / 3.5;
    rows.push({ bearing, model, sigma, true: Math.round(trueLen), raw: `${(((a.gpsDistance - trueLen) / trueLen) * 100).toFixed(1)}%`, osrm: a.matchedDistance ? `${(((a.matchedDistance - trueLen) / trueLen) * 100).toFixed(1)}%` : "-", conf: a.matchConfidence?.toFixed(2), used: a.distanceSource, t1km: a.resultSeconds, trueT: trueT.toFixed(1), err: a.resultSeconds ? `${(((a.resultSeconds - trueT) / trueT) * 100).toFixed(1)}%` : "-" });
  }
}
console.table(rows);
