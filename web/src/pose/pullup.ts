// Counts pull-ups from body landmarks (MediaPipe Pose: 33 points, x and y
// normalised to the frame, y down).
//
// A rep counts when the athlete starts from a full hang (arms straight),
// pulls until the chin is above the bar (the line of the hands), and comes
// back down to a full hang. A pull that stops short of the bar, or a rep
// that starts again before the arms were straight, is counted as invalid.

export interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

export interface PullupConfig {
  /** Elbow angle (degrees) counted as a full hang. */
  extendedAngle: number;
  /** Elbow angle below which the pull has started. */
  bentAngle: number;
  /** How far (in arm lengths) the chin must clear the bar line. */
  chinMargin: number;
  minVisibility: number;
  /** Weight of the newest frame in the moving average (0–1). */
  smoothing: number;
  /** Reps faster than this are noise. */
  minRepMs: number;
  /** Time off the bar after which the set is over. */
  offBarMs: number;
}

export const DEFAULT_CONFIG: PullupConfig = {
  extendedAngle: 150,
  bentAngle: 120,
  chinMargin: 0.0,
  minVisibility: 0.5,
  smoothing: 0.5,
  minRepMs: 600,
  offBarMs: 1200,
};

export type Phase = "off" | "hang" | "pull" | "top" | "lower";

export interface RepLog {
  n: number;
  valid: boolean;
  reason?: string;
  durationMs: number;
  minElbow: number;
  at: number;
}

export interface Metrics {
  elbow: number;
  /** Chin height above the hands, in arm lengths (positive = above the bar). */
  chinOverBar: number;
  /** Sideways swing of the hips, in shoulder widths. */
  swing: number;
  onBar: boolean;
}

export interface PullupState {
  phase: Phase;
  valid: number;
  invalid: number;
  reps: RepLog[];
  metrics: Metrics | null;
  feedback: string;
  swingWarnings: number;
}

const L = { nose: 0, mouthL: 9, mouthR: 10, shL: 11, shR: 12, elL: 13, elR: 14, wrL: 15, wrR: 16, hipL: 23, hipR: 24 };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

function angle(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/**
 * Reads the measurements a pull-up depends on from one frame, or null when
 * the arms are not visible. `aspect` is frame width / height, so that x and y
 * are in the same units.
 */
export function measure(lm: Landmark[] | null | undefined, aspect = 1, minVisibility = 0.5): Metrics | null {
  if (!lm || lm.length < 25) return null;
  const p = (i: number) => ({ x: lm[i].x * aspect, y: lm[i].y });
  const vis = (i: number) => lm[i].visibility ?? 1;
  const sides = [
    [L.shL, L.elL, L.wrL],
    [L.shR, L.elR, L.wrR],
  ].filter((s) => s.every((i) => vis(i) >= minVisibility));
  if (!sides.length) return null;

  const elbow = sides.reduce((sum, [s, e, w]) => sum + angle(p(s), p(e), p(w)), 0) / sides.length;
  const armLen = sides.reduce((sum, [s, e, w]) => sum + dist(p(s), p(e)) + dist(p(e), p(w)), 0) / sides.length;
  const wristY = sides.reduce((sum, [, , w]) => sum + p(w).y, 0) / sides.length;
  const shoulderY = sides.reduce((sum, [s]) => sum + p(s).y, 0) / sides.length;

  // The chin is not a landmark: it is about as far below the mouth as the mouth is below the nose.
  let chinY: number;
  if (vis(L.nose) >= minVisibility && vis(L.mouthL) >= minVisibility && vis(L.mouthR) >= minVisibility) {
    const mouthY = (p(L.mouthL).y + p(L.mouthR).y) / 2;
    chinY = mouthY + (mouthY - p(L.nose).y) * 0.9;
  } else {
    // Face hidden (e.g. filmed from behind): the chin is about 0.25 arm lengths above the shoulders.
    chinY = shoulderY - 0.25 * armLen;
  }

  let swing = 0;
  if ([L.shL, L.shR, L.hipL, L.hipR].every((i) => vis(i) >= minVisibility)) {
    const shoulderW = dist(p(L.shL), p(L.shR)) || 1;
    swing = Math.abs((p(L.hipL).x + p(L.hipR).x) / 2 - (p(L.shL).x + p(L.shR).x) / 2) / shoulderW;
  }

  return {
    elbow,
    chinOverBar: (wristY - chinY) / (armLen || 1),
    swing,
    // Hanging: the hands are above the shoulders.
    onBar: wristY < shoulderY - 0.15 * armLen,
  };
}

export class PullupCounter {
  private cfg: PullupConfig;
  private s!: PullupState;
  private smooth: Metrics | null = null;
  private repStart = 0;
  private minElbow = 180;
  private lastOnBar = 0;
  private swingFlag = false;

  constructor(config: Partial<PullupConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.reset();
  }

  reset() {
    this.s = { phase: "off", valid: 0, invalid: 0, reps: [], metrics: null, feedback: "Turnikka osiling, qo'llar to'liq tushgan bo'lsin", swingWarnings: 0 };
    this.smooth = null;
    this.minElbow = 180;
  }

  get state(): PullupState {
    return { ...this.s, reps: [...this.s.reps] };
  }

  private finish(valid: boolean, t: number, reason?: string) {
    if (valid) this.s.valid += 1;
    else this.s.invalid += 1;
    this.s.reps.push({ n: this.s.reps.length + 1, valid, reason, durationMs: t - this.repStart, minElbow: Math.round(this.minElbow), at: t });
    this.s.feedback = valid ? `${this.s.valid} ✓` : `Hisoblanmadi: ${reason}`;
  }

  update(landmarks: Landmark[] | null | undefined, t: number, aspect = 1): PullupState {
    const raw = measure(landmarks, aspect, this.cfg.minVisibility);
    if (!raw) {
      if (this.s.phase !== "off" && t - this.lastOnBar > this.cfg.offBarMs) this.s.phase = "off";
      this.s.feedback = "Qo'llar va yelkalar kadrda ko'rinmayapti";
      return this.state;
    }
    const a = this.cfg.smoothing;
    const m: Metrics = this.smooth
      ? {
          elbow: a * raw.elbow + (1 - a) * this.smooth.elbow,
          chinOverBar: a * raw.chinOverBar + (1 - a) * this.smooth.chinOverBar,
          swing: a * raw.swing + (1 - a) * this.smooth.swing,
          onBar: raw.onBar,
        }
      : raw;
    this.smooth = m;
    this.s.metrics = m;
    if (m.onBar) this.lastOnBar = t;

    const { extendedAngle, bentAngle, chinMargin } = this.cfg;
    const chinAbove = m.chinOverBar > chinMargin;
    const chinBelow = m.chinOverBar < chinMargin - 0.08;
    const extended = m.elbow >= extendedAngle;

    if (m.swing > 0.8 && this.s.phase !== "off") {
      if (!this.swingFlag) this.s.swingWarnings += 1;
      this.swingFlag = true;
      this.s.feedback = "Gavdani tebratmang";
    } else if (m.swing < 0.5) {
      this.swingFlag = false;
    }

    if (this.s.phase !== "off" && !m.onBar && t - this.lastOnBar > this.cfg.offBarMs) {
      this.s.phase = "off";
      this.s.feedback = "Turnikdan tushdingiz";
      return this.state;
    }

    this.minElbow = Math.min(this.minElbow, m.elbow);
    switch (this.s.phase) {
      case "off":
        if (m.onBar && extended) {
          this.s.phase = "hang";
          this.s.feedback = "Tortiling!";
        } else if (m.onBar) {
          this.s.feedback = "Qo'llarni to'liq tushiring (to'liq osilish)";
        }
        break;
      case "hang":
        if (m.elbow < bentAngle) {
          this.s.phase = "pull";
          this.repStart = t;
          this.minElbow = m.elbow;
        }
        break;
      case "pull":
        if (chinAbove) {
          this.s.phase = "top";
          this.s.feedback = "Pastga, qo'llar to'liq to'g'rilansin";
        } else if (extended) {
          this.finish(false, t, "iyak turnikdan oshmadi");
          this.s.phase = "hang";
        }
        break;
      case "top":
        if (chinBelow) this.s.phase = "lower";
        break;
      case "lower":
        if (extended) {
          if (t - this.repStart >= this.cfg.minRepMs) this.finish(true, t);
          this.s.phase = "hang";
        } else if (chinAbove) {
          this.finish(false, t, "pastga to'liq tushmadi");
          this.repStart = t;
          this.minElbow = m.elbow;
          this.s.phase = "top";
        }
        break;
    }
    return this.state;
  }
}
