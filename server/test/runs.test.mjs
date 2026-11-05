import assert from "node:assert/strict";
import { test } from "node:test";
import { destination } from "../../shared/geo.js";
import { analyzeRun } from "../src/runs.mjs";

const START = { lat: 41.3, lon: 69.25 };
const T0 = 1_700_000_000_000;

/** A straight run east at `speed` m/s with a zigzag of `zig` metres (GPS noise). */
function run(seconds, speed, zig = 0) {
  return Array.from({ length: seconds + 1 }, (_, s) => {
    const p = destination(START, 90, s * speed);
    return { ...destination(p, 0, s % 2 ? zig : -zig), t: T0 + s * 1000, acc: 5 };
  });
}

/** OSRM stand-in that knows the true line: distance = speed × time, except where told to skip. */
function fakeOsrm(speed, { confidence = 0.8, skip = null, unmatchedChunks = 0 } = {}) {
  return {
    match: async (points) => {
      const samples = [];
      let d = 0;
      let prevT = null;
      for (const p of points) {
        const s = (p.t - T0) / 1000;
        if (skip && s > skip[0] && s < skip[1]) continue;
        // Across a skipped stretch OSRM "takes a shortcut" of 10 m.
        if (prevT != null) d += skip && (prevT - T0) / 1000 <= skip[0] && s >= skip[1] ? 10 : ((p.t - prevT) / 1000) * speed;
        samples.push({ t: p.t, d });
        prevT = p.t;
      }
      return { distance: d, confidence, lines: [[[0, 0], [1, 1]]], samples, gapDistance: 0, unmatchedChunks };
    },
  };
}

test("GPS only: the zigzag is smoothed out of the distance", async () => {
  const a = await analyzeRun({ points: run(300, 4, 3), targetDistance: 1000 });
  assert.equal(a.distanceSource, "gps");
  assert.ok(a.gpsDistance > 1300, `raw ${a.gpsDistance}`);
  assert.ok(a.distance < a.gpsDistance * 0.9, `smoothed ${a.distance}`);
  assert.ok(a.warnings.some((w) => /OSRM sozlanmagan/.test(w)));
});

test("with OSRM: time at the target comes from the matched distance", async () => {
  const a = await analyzeRun({ points: run(300, 4, 3), targetDistance: 1000, osrm: fakeOsrm(4) });
  assert.equal(a.distanceSource, "osrm");
  assert.ok(Math.abs(a.resultSeconds - 250) < 1, `got ${a.resultSeconds}`);
  assert.ok(Math.abs(a.distance - 1200) < 5);
  assert.ok(a.scale < 0.95, "the phone's live distance gets corrected down");
  assert.equal(a.splits.length, 1);
});

test("fixes OSRM skipped (U-turn) are counted from the GPS", async () => {
  const a = await analyzeRun({ points: run(300, 4), targetDistance: 1000, osrm: fakeOsrm(4, { skip: [100, 150] }) });
  assert.equal(a.distanceSource, "osrm");
  assert.ok(Math.abs(a.resultSeconds - 250) < 2, `got ${a.resultSeconds}`);
  assert.ok(a.warnings.some((w) => /moslanmagan joylarda/.test(w)));
});

test("low confidence or unmatched chunks fall back to GPS", async () => {
  const low = await analyzeRun({ points: run(300, 4), targetDistance: 1000, osrm: fakeOsrm(4, { confidence: 0.1 }) });
  assert.equal(low.distanceSource, "gps");
  const part = await analyzeRun({ points: run(300, 4), targetDistance: 1000, osrm: fakeOsrm(4, { unmatchedChunks: 1 }) });
  assert.equal(part.distanceSource, "gps");
});

test("a map path much longer than the GPS track is not trusted", async () => {
  const a = await analyzeRun({ points: run(300, 4), targetDistance: 1000, osrm: fakeOsrm(6) });
  assert.equal(a.distanceSource, "gps");
  assert.ok(a.warnings.some((w) => /juda farq/.test(w)));
});

test("not enough distance, and not enough points", async () => {
  const a = await analyzeRun({ points: run(100, 4), targetDistance: 1000, osrm: fakeOsrm(4) });
  assert.equal(a.completed, false);
  assert.equal(a.resultSeconds, null);
  const b = await analyzeRun({ points: run(0, 4) });
  assert.equal(b.ok, false);
});
