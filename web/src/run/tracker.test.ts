import { describe, expect, it } from "vitest";
import { destination } from "../../../shared/geo.js";
import { RunTracker, simulateFixes } from "./tracker";

describe("RunTracker", () => {
  it("signals the target once, and again after a smaller correction", () => {
    const start = { lat: 41.3, lon: 69.25 };
    const tr = new RunTracker(1000);
    let hits = 0;
    tr.onTarget = () => (hits += 1);
    tr.start(0, { ...start, t: 0, acc: 5 });
    for (let s = 1; s <= 250; s++) tr.add({ ...destination(start, 90, s * 4), t: s * 1000, acc: 5 });
    expect(hits).toBe(1);
    expect(Math.round(tr.distance)).toBe(1000);
    // The map says the GPS was 5% long: the target is no longer reached.
    tr.setScale(0.95);
    expect(Math.round(tr.distance)).toBe(950);
    for (let s = 251; s <= 262; s++) tr.add({ ...destination(start, 90, s * 4), t: s * 1000, acc: 5 });
    expect(hits).toBe(1);
    for (let s = 263; s <= 265; s++) tr.add({ ...destination(start, 90, s * 4), t: s * 1000, acc: 5 });
    expect(hits).toBe(2);
    tr.finish(263_000);
    const st = tr.stats(999_999);
    expect(st.running).toBe(false);
    expect(st.elapsedMs).toBe(263_000);
    expect(Math.abs(st.currentPace! - 250 / 0.95)).toBeLessThan(2);
  });

  it("ignores poor fixes and jumps", () => {
    const start = { lat: 41.3, lon: 69.25 };
    const tr = new RunTracker(null);
    tr.start(0, { ...start, t: 0, acc: 5 });
    tr.add({ ...destination(start, 0, 10), t: 1000, acc: 120 });
    tr.add({ ...destination(start, 0, 500), t: 2000, acc: 5 });
    tr.add({ ...destination(start, 0, 8), t: 3000, acc: 5 });
    expect(Math.round(tr.distance)).toBe(8);
  });

  it("simulates fixes along a line at the given speed", () => {
    const a = { lat: 41.3, lon: 69.25 };
    const b = destination(a, 0, 1000);
    const fixes = simulateFixes([[a.lon, a.lat], [b.lon, b.lat]], 5, 0, 0);
    expect(fixes.length).toBeGreaterThanOrEqual(200);
    expect(fixes.length).toBeLessThanOrEqual(201);
    expect(fixes[1].t - fixes[0].t).toBe(1000);
  });
});
