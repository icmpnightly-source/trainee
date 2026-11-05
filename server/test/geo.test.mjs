import assert from "node:assert/strict";
import { test } from "node:test";
import { cumulative, destination, downsample, filterTrack, formatDuration, haversine, smoothTrack, splits, timeAtDistance, timeAtSamples, trackDistance } from "../../shared/geo.js";

/** A straight run north at `speed` m/s, one fix per second. */
function straightRun(meters, speed, start = { lat: 41.3, lon: 69.25 }, t0 = 1_700_000_000_000) {
  const pts = [];
  for (let s = 0; s * speed <= meters; s++) pts.push({ ...destination(start, 0, s * speed), t: t0 + s * 1000, acc: 5 });
  return pts;
}

test("haversine matches a known distance", () => {
  // One degree of latitude is about 111.2 km.
  const d = haversine({ lat: 41, lon: 69 }, { lat: 42, lon: 69 });
  assert.ok(Math.abs(d - 111195) < 50, `got ${d}`);
});

test("destination and haversine agree", () => {
  const a = { lat: 41.3, lon: 69.25 };
  assert.ok(Math.abs(haversine(a, destination(a, 77, 1234)) - 1234) < 0.5);
});

test("filter drops bad accuracy, teleports and standing jitter", () => {
  const run = straightRun(100, 4);
  const noisy = [
    ...run.slice(0, 10),
    { ...destination(run[9], 90, 400), t: run[9].t + 500 }, // 400 m in half a second
    { ...run[10], acc: 80 }, // poor fix
    ...run.slice(10),
    { ...run[run.length - 1], t: run[run.length - 1].t + 1000, lat: run[run.length - 1].lat + 0.000005 }, // 0.5 m jitter
  ];
  const f = filterTrack(noisy);
  assert.equal(f.length, run.length);
  assert.ok(Math.abs(trackDistance(f) - trackDistance(run)) < 0.01);
});

test("time at distance is interpolated", () => {
  const run = straightRun(3000, 4); // 750 s for 3 km
  const ms = timeAtDistance(run, 3000);
  assert.ok(Math.abs(ms - 750_000) < 50, `got ${ms}`);
  assert.equal(timeAtDistance(run, 5000), null);
  // With a 0.9 scale the target is reached later.
  assert.ok(timeAtDistance(run, 2700, 0.9) > 749_000);
});

test("splits per km", () => {
  const s = splits(straightRun(3000, 4), 1000);
  assert.equal(s.length, 3);
  for (const sp of s) assert.ok(Math.abs(sp.paceSecPerKm - 250) < 0.5);
});

test("downsample keeps both ends", () => {
  const run = straightRun(500, 2);
  const d = downsample(run, 10, 1);
  assert.deepEqual(d[0], run[0]);
  assert.deepEqual(d[d.length - 1], run[run.length - 1]);
  assert.ok(d.length < run.length / 4);
  assert.equal(cumulative([]).length, 0);
});

test("durations", () => {
  assert.equal(formatDuration(754), "12:34");
  assert.equal(formatDuration(3754), "1:02:34");
  assert.equal(formatDuration(9.96), "0:10");
  assert.equal(formatDuration(65.25), "1:05.3");
  assert.equal(formatDuration(null), "—");
});

test("samples: time at distance between two samples", () => {
  const s = [{ t: 1000, d: 0 }, { t: 3000, d: 10 }, { t: 5000, d: 30 }];
  assert.equal(timeAtSamples(s, 20), 3000);
  assert.equal(timeAtSamples(s, 5), 1000);
  assert.equal(timeAtSamples(s, 31), null);
});

test("smoothing takes zigzag out of a straight line", () => {
  const start = { lat: 41.3, lon: 69.25 };
  const zig = Array.from({ length: 200 }, (_, s) => ({ ...destination(destination(start, 90, s * 4), 0, s % 2 ? 3 : -3), t: s * 1000 }));
  const raw = trackDistance(zig);
  const smooth = trackDistance(smoothTrack(zig, 3));
  assert.ok(raw > 900, `raw ${raw}`);
  // 199 steps of 4 m: ±3 m of zigzag left as ±1 m after a 3-point average.
  assert.ok(Math.abs(smooth - 199 * Math.hypot(4, 2)) < 10, `smooth ${smooth}`);
  assert.ok(smooth < raw * 0.65);
});
