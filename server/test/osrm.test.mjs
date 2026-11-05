// Runs against a real osrm-routed when OSRM_TEST_URL is set, e.g. the
// Monaco extract from the OSRM repository:
//   OSRM_TEST_URL=http://127.0.0.1:5000 npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { destination, haversine } from "../../shared/geo.js";
import { createOsrm } from "../src/osrm.mjs";
import { analyzeRun } from "../src/runs.mjs";

const url = process.env.OSRM_TEST_URL;
const osrm = url && createOsrm({ baseUrl: url, profile: "foot" });
const start = { lat: Number(process.env.OSRM_TEST_LAT ?? 43.7384), lon: Number(process.env.OSRM_TEST_LON ?? 7.4246) };

/** Walks a route's geometry at `speed` m/s, one fix per second, with GPS-like noise. */
function simulate(coords, speed, noise = 4) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const line = coords.map(([lon, lat]) => ({ lat, lon }));
  const pts = [];
  let t = 1_700_000_000_000;
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = haversine(line[i - 1], line[i]);
    let d = carry;
    for (; d < seg; d += speed) {
      const f = d / seg;
      const p = { lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * f, lon: line[i - 1].lon + (line[i].lon - line[i - 1].lon) * f };
      const off = destination(p, (rand() + 1) * 180, Math.abs(rand()) * noise);
      pts.push({ ...off, t, acc: 5 + Math.abs(rand()) * 5 });
      t += 1000;
    }
    carry = d - seg;
  }
  return pts;
}

test("OSRM: loop course, then a noisy run on it is matched", { skip: !url && "OSRM_TEST_URL yo'q" }, async () => {
  const st = await osrm.status(start);
  assert.equal(st.ok, true);

  const loop = await osrm.loop(start, 2000);
  assert.ok(Math.abs(loop.distance - 2000) / 2000 < 0.3, `loop ${loop.distance}`);

  const points = simulate(loop.coordinates, 3.5);
  const run = await analyzeRun({ points, targetDistance: 1000, osrm });
  assert.equal(run.ok, true);
  assert.equal(run.distanceSource, "osrm", run.warnings.join("; "));
  console.log(`  course ${loop.distance.toFixed(0)} m, gps ${run.gpsDistance.toFixed(0)} m, result ${run.distance.toFixed(0)} m, confidence ${run.matchConfidence.toFixed(2)}, 1 km in ${run.resultSeconds} s (true ${(1000 / 3.5).toFixed(1)})`);
  // GPS noise makes the raw track longer; the matched one is close to the course.
  assert.ok(Math.abs(run.distance - loop.distance) / loop.distance < 0.06);
  assert.ok(Math.abs(run.resultSeconds - 1000 / 3.5) / (1000 / 3.5) < 0.06);
});

test("OSRM: out and back (with a U-turn)", { skip: !url && "OSRM_TEST_URL yo'q" }, async () => {
  const out = await osrm.route([start, destination(start, 60, 600)]);
  const course = [...out.coordinates, ...out.coordinates.slice().reverse().slice(1)];
  const run = await analyzeRun({ points: simulate(course, 3.5), targetDistance: 1000, osrm });
  console.log(`  course ${(out.distance * 2).toFixed(0)} m, result ${run.distance.toFixed(0)} m via ${run.distanceSource}, 1 km in ${run.resultSeconds} s`);
  assert.ok(Math.abs(run.resultSeconds - 1000 / 3.5) / (1000 / 3.5) < 0.06);
});
