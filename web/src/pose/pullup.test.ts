import { describe, expect, it } from "vitest";
import { type Landmark, measure, PullupCounter } from "./pullup";

// A front view of someone on a bar at y = 0.2, as MediaPipe would report it.
// `lift` is the vertical distance from the shoulders to the bar: ~0.29 at a
// full hang, about 0 with the chin over the bar.
const UPPER = 0.15;
const FORE = 0.15;
const BAR = 0.2;

function elbowPoint(s: { x: number; y: number }, w: { x: number; y: number }, outward: number) {
  const d = Math.hypot(w.x - s.x, w.y - s.y);
  const a = (UPPER ** 2 - FORE ** 2 + d ** 2) / (2 * d);
  const h = Math.sqrt(Math.max(0, UPPER ** 2 - a ** 2));
  const mx = s.x + (a * (w.x - s.x)) / d;
  const my = s.y + (a * (w.y - s.y)) / d;
  const ux = -(w.y - s.y) / d;
  const uy = (w.x - s.x) / d;
  const e1 = { x: mx + h * ux, y: my + h * uy };
  const e2 = { x: mx - h * ux, y: my - h * uy };
  return (e1.x - s.x) * outward > (e2.x - s.x) * outward ? e1 : e2;
}

function frame(lift: number, jitter = 0, rand = Math.random): Landmark[] {
  const j = () => (rand() * 2 - 1) * jitter;
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, visibility: 0.9 }));
  const shY = BAR + lift;
  const pts: Record<number, { x: number; y: number }> = {
    15: { x: 0.36, y: BAR },
    16: { x: 0.64, y: BAR },
    11: { x: 0.42, y: shY },
    12: { x: 0.58, y: shY },
    0: { x: 0.5, y: shY - 0.09 },
    9: { x: 0.48, y: shY - 0.06 },
    10: { x: 0.52, y: shY - 0.06 },
    23: { x: 0.45, y: shY + 0.25 },
    24: { x: 0.55, y: shY + 0.25 },
  };
  pts[13] = elbowPoint(pts[11], pts[15], -1);
  pts[14] = elbowPoint(pts[12], pts[16], 1);
  for (const [i, p] of Object.entries(pts)) lm[Number(i)] = { x: p.x + j(), y: p.y + j(), visibility: 0.95 };
  return lm;
}

/** Frames at 30 fps going from one lift to another over `ms`. */
function move(from: number, to: number, ms: number) {
  const n = Math.round((ms / 1000) * 30);
  return Array.from({ length: n }, (_, i) => from + ((to - from) * (i + 1)) / n);
}

const HANG = 0.29;
const TOP = -0.02;

function run(lifts: number[], counter = new PullupCounter(), jitter = 0) {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let t = 0;
  let state = counter.state;
  for (const lift of lifts) {
    state = counter.update(frame(lift, jitter, rand), t);
    t += 1000 / 30;
  }
  return state;
}

const rep = (bottom = HANG, top = TOP) => [...move(bottom, top, 900), ...move(top, top, 200), ...move(top, bottom, 900), ...move(bottom, bottom, 300)];
const start = move(HANG, HANG, 500);

describe("measure", () => {
  it("sees a straight-armed hang and a chin over the bar", () => {
    const hang = measure(frame(HANG))!;
    expect(hang.elbow).toBeGreaterThan(155);
    expect(hang.onBar).toBe(true);
    expect(hang.chinOverBar).toBeLessThan(0);
    const top = measure(frame(TOP))!;
    expect(top.elbow).toBeLessThan(60);
    expect(top.chinOverBar).toBeGreaterThan(0);
  });

  it("returns null with the arms hidden", () => {
    const lm = frame(HANG).map((p) => ({ ...p, visibility: 0.1 }));
    expect(measure(lm)).toBeNull();
    expect(measure(null)).toBeNull();
  });
});

describe("PullupCounter", () => {
  it("counts full reps", () => {
    const s = run([...start, ...rep(), ...rep(), ...rep(), ...rep(), ...rep()]);
    expect(s.valid).toBe(5);
    expect(s.invalid).toBe(0);
    expect(s.phase).toBe("hang");
  });

  it("counts full reps through landmark jitter", () => {
    const s = run([...start, ...rep(), ...rep(), ...rep(), ...rep(), ...rep()], new PullupCounter(), 0.004);
    expect(s.valid).toBe(5);
    expect(s.invalid).toBe(0);
  });

  it("does not count a pull that stops below the bar", () => {
    const s = run([...start, ...rep(), ...rep(HANG, 0.1), ...rep()]);
    expect(s.valid).toBe(2);
    expect(s.invalid).toBe(1);
    expect(s.reps[1].reason).toMatch(/iyak/);
  });

  it("does not count a rep that starts before the arms are straight", () => {
    // Up, half way down, up again, then all the way down.
    const s = run([...start, ...move(HANG, TOP, 900), ...move(TOP, 0.12, 600), ...move(0.12, TOP, 600), ...move(TOP, HANG, 900), ...move(HANG, HANG, 300)]);
    expect(s.invalid).toBe(1);
    expect(s.reps[0].reason).toMatch(/to'liq tushmadi/);
    expect(s.valid).toBe(1);
  });

  it("waits for a full hang before the first rep", () => {
    // Starts with bent arms: the first pull is not counted until a full hang.
    const s = run([...move(0.15, 0.15, 500), ...move(0.15, TOP, 500), ...move(TOP, HANG, 900), ...move(HANG, HANG, 300), ...rep()]);
    expect(s.valid).toBe(1);
    expect(s.reps).toHaveLength(1);
  });

  it("goes off the bar when the hands come down", () => {
    const counter = new PullupCounter();
    run([...start, ...rep()], counter);
    let t = 100_000;
    let s = counter.state;
    // Standing under the bar: hands at the hips.
    for (let i = 0; i < 60; i++) {
      const lm = frame(HANG).map((p, idx) => (idx === 15 || idx === 16 ? { ...p, y: 0.75 } : p));
      s = counter.update(lm, (t += 33));
    }
    expect(s.phase).toBe("off");
    expect(s.valid).toBe(1);
  });
});
