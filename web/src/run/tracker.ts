// Live run tracking on the phone: GPS fixes in, distance and pace out, and
// the exact moment the target distance was crossed.
import { acceptFix, destination, haversine } from "../../../shared/geo.js";

export interface Fix {
  lat: number;
  lon: number;
  t: number;
  acc: number | null;
}

export interface LiveStats {
  running: boolean;
  startedAt: number | null;
  elapsedMs: number;
  distance: number;
  /** Pace over the last ~200 m, s/km. */
  currentPace: number | null;
  avgPace: number | null;
  fixes: number;
  lastAccuracy: number | null;
  finishedMs: number | null;
}

/**
 * Distance here is the phone's filtered GPS distance times `scale`, the
 * correction that map matching on the local OSRM found for this run so far
 * (GPS zigzag makes raw distance too long). `onTarget` fires when the
 * corrected distance first reaches the target; the page then asks the server
 * to confirm before the run is finished.
 */
export class RunTracker {
  readonly all: Fix[] = [];
  readonly kept: Fix[] = [];
  private cum: number[] = [];
  startedAt: number | null = null;
  finishedMs: number | null = null;
  target: number | null;
  scale = 1;
  onTarget?: () => void;
  private notified = false;

  constructor(target: number | null) {
    this.target = target;
  }

  /** Starts the clock at `t`, from the last good fix (the runner is standing on it). */
  start(t: number, from: Fix) {
    this.startedAt = t;
    this.add({ ...from, t });
  }

  add(fix: Fix) {
    if (this.startedAt == null || this.finishedMs != null) return;
    if (fix.t < this.startedAt) return;
    this.all.push(fix);
    const last = this.kept[this.kept.length - 1];
    if (!acceptFix(last, fix)) return;
    const prevCum = this.cum.length ? this.cum[this.cum.length - 1] : 0;
    this.kept.push(fix);
    this.cum.push(prevCum + (last ? haversine(last, fix) : 0));
    this.check();
  }

  /** New correction from the server; re-arms the target if it is no longer reached. */
  setScale(scale: number) {
    if (!Number.isFinite(scale) || scale <= 0) return;
    this.scale = scale;
    if (this.target && this.distance < this.target) this.notified = false;
  }

  /** The server says the target is not reached yet: wait for it again. */
  rearm() {
    this.notified = false;
    this.check();
  }

  finish(elapsedMs: number) {
    this.finishedMs = elapsedMs;
  }

  private check() {
    if (this.target && !this.notified && this.distance >= this.target) {
      this.notified = true;
      this.onTarget?.();
    }
  }

  get rawDistance() {
    return this.cum.length ? this.cum[this.cum.length - 1] : 0;
  }

  get distance() {
    return this.rawDistance * this.scale;
  }

  stats(now: number): LiveStats {
    const distance = this.distance;
    const elapsedMs = this.startedAt == null ? 0 : this.finishedMs ?? now - this.startedAt;
    let currentPace: number | null = null;
    const n = this.kept.length;
    if (n >= 2) {
      let i = n - 1;
      while (i > 0 && this.cum[n - 1] - this.cum[i] < 200) i--;
      const d = (this.cum[n - 1] - this.cum[i]) * this.scale;
      const dt = (this.kept[n - 1].t - this.kept[i].t) / 1000;
      if (d > 20 && dt > 0) currentPace = dt / (d / 1000);
    }
    return {
      running: this.startedAt != null && this.finishedMs == null,
      startedAt: this.startedAt,
      elapsedMs,
      distance,
      currentPace,
      avgPace: distance > 20 ? elapsedMs / 1000 / (distance / 1000) : null,
      fixes: this.all.length,
      lastAccuracy: this.all.length ? this.all[this.all.length - 1].acc : null,
      finishedMs: this.finishedMs,
    };
  }
}

/** Watches the phone's GPS. Returns a function that stops watching. */
export function watchGps(onFix: (f: Fix) => void, onError: (message: string) => void) {
  if (!("geolocation" in navigator)) {
    onError("Bu brauzerda GPS yo'q");
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, t: pos.timestamp || Date.now(), acc: pos.coords.accuracy ?? null }),
    (err) => {
      const messages: Record<number, string> = {
        1: "GPS ga ruxsat berilmadi (brauzer sozlamalarida joylashuvga ruxsat bering; sahifa HTTPS orqali ochilgan bo'lishi kerak)",
        2: "Joylashuv aniqlanmadi — ochiq joyga chiqing",
        3: "GPS javob bermadi",
      };
      onError(messages[err.code] ?? err.message);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/**
 * Fixes along a route at `speed` m/s, one per second of run time, with a few
 * metres of GPS-like noise. For trying the screens without going outside.
 */
export function simulateFixes(coords: [number, number][], speed: number, t0: number, noise = 3): Fix[] {
  const out: Fix[] = [];
  const line = coords.map(([lon, lat]) => ({ lat, lon }));
  let t = t0;
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const seg = haversine(line[i - 1], line[i]);
    let d = carry;
    for (; d < seg; d += speed) {
      const f = d / seg;
      const p = { lat: line[i - 1].lat + (line[i].lat - line[i - 1].lat) * f, lon: line[i - 1].lon + (line[i].lon - line[i - 1].lon) * f };
      const jitter = destination(p, Math.random() * 360, Math.random() * noise);
      out.push({ ...jitter, t, acc: 4 + Math.random() * 6 });
      t += 1000;
    }
    carry = d - seg;
  }
  return out;
}

/** Keeps the screen on while running (where the browser allows it). */
export async function keepScreenOn(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release();
  } catch {
    return () => {};
  }
}
