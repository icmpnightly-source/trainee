// GPS track maths shared by the server and the web app.
// A point is { lat, lon, t, acc? }: degrees, milliseconds since epoch, metres.

const EARTH_RADIUS_M = 6371008.8;
const toRad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance between two points, in metres. */
export function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `distance` metres from `origin` on `bearingDeg` (0 = north). */
export function destination(origin, bearingDeg, distance) {
  const d = distance / EARTH_RADIUS_M;
  const br = toRad(bearingDeg);
  const lat1 = toRad(origin.lat);
  const lon1 = toRad(origin.lon);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lon2 =
    lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: ((((lon2 * 180) / Math.PI + 540) % 360) - 180) };
}

export const DEFAULT_FILTER = {
  maxAccuracy: 30, // metres: fixes worse than this are dropped
  maxSpeed: 10, // m/s: faster jumps are GPS glitches, not running
  minStep: 3, // metres: smaller moves are jitter while standing still
};

/**
 * Drops the fixes that would add fake distance: poor accuracy, impossible
 * speed, and jitter. Returns a new array sorted by time.
 */
export function filterTrack(points, options = {}) {
  const sorted = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && Number.isFinite(p.t))
    .slice()
    .sort((a, b) => a.t - b.t);
  const kept = [];
  for (const p of sorted) {
    if (acceptFix(kept[kept.length - 1], p, options)) kept.push(p);
  }
  return kept;
}

/** Whether fix `p` should follow `last` (the previous kept fix) in a filtered track. */
export function acceptFix(last, p, options = {}) {
  const opt = { ...DEFAULT_FILTER, ...options };
  if (p.acc != null && p.acc > opt.maxAccuracy) return false;
  if (!last) return true;
  const dt = (p.t - last.t) / 1000;
  if (dt <= 0) return false;
  const d = haversine(last, p);
  return d / dt <= opt.maxSpeed && d >= opt.minStep;
}

/** Cumulative distance in metres at every point. */
export function cumulative(points) {
  const out = new Array(points.length);
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) sum += haversine(points[i - 1], points[i]);
    out[i] = sum;
  }
  return out;
}

export function trackDistance(points) {
  return points.length ? cumulative(points)[points.length - 1] : 0;
}

/** Cumulative distance over time: [{ t, d }] for every point; `scale` multiplies d. */
export function samplesOf(points, scale = 1) {
  const cum = cumulative(points);
  return points.map((p, i) => ({ t: p.t, d: cum[i] * scale }));
}

/**
 * Milliseconds from the first sample until `target` metres were covered,
 * interpolated between the two samples around it; null if never reached.
 */
export function timeAtSamples(samples, target) {
  if (samples.length < 2) return null;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].d >= target) {
      const span = samples[i].d - samples[i - 1].d;
      const f = span > 0 ? (target - samples[i - 1].d) / span : 0;
      return samples[i - 1].t + f * (samples[i].t - samples[i - 1].t) - samples[0].t;
    }
  }
  return null;
}

/** Time of each full `every` metres, with the pace of that split. */
export function splitsFromSamples(samples, every = 1000) {
  const total = samples.length ? samples[samples.length - 1].d : 0;
  const out = [];
  let prev = 0;
  for (let mark = every; mark <= total + 1e-6; mark += every) {
    const at = timeAtSamples(samples, mark);
    if (at == null) break;
    out.push({ distance: mark, elapsedMs: at, splitMs: at - prev, paceSecPerKm: ((at - prev) / 1000) * (1000 / every) });
    prev = at;
  }
  return out;
}

/** timeAtSamples over a GPS track; `scale` multiplies the measured distances. */
export function timeAtDistance(points, target, scale = 1) {
  return timeAtSamples(samplesOf(points, scale), target);
}

export function splits(points, every = 1000, scale = 1) {
  return splitsFromSamples(samplesOf(points, scale), every);
}

/**
 * Centred moving average of the positions. Independent GPS errors from fix
 * to fix make a track zigzag and read long; averaging takes most of that out.
 */
export function smoothTrack(points, window = 5) {
  const half = Math.floor(window / 2);
  return points.map((p, i) => {
    // Symmetric around i, narrower near the ends, so the start and finish stay where they were.
    const h = Math.min(half, i, points.length - 1 - i);
    const from = i - h;
    const to = i + h;
    let lat = 0;
    let lon = 0;
    for (let j = from; j <= to; j++) {
      lat += points[j].lat;
      lon += points[j].lon;
    }
    const n = to - from + 1;
    return { ...p, lat: lat / n, lon: lon / n };
  });
}

/** Keeps fixes at least `minDistance` metres and `minSeconds` apart (first and last always kept). */
export function downsample(points, minDistance = 5, minSeconds = 1) {
  if (points.length <= 2) return points.slice();
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (haversine(last, points[i]) >= minDistance && points[i].t - last.t >= minSeconds * 1000) out.push(points[i]);
  }
  const end = points[points.length - 1];
  if (end.t - out[out.length - 1].t >= 1000) out.push(end);
  else out[out.length - 1] = end;
  return out;
}

/** Length of a [lon, lat] line string in metres. */
export function lineLength(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) {
    sum += haversine({ lat: coords[i - 1][1], lon: coords[i - 1][0] }, { lat: coords[i][1], lon: coords[i][0] });
  }
  return sum;
}

/** 754 -> "12:34", 3754 -> "1:02:34". */
export function formatDuration(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const s = Math.round(Math.max(0, totalSeconds) * 10) / 10;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round((s % 60) * 10) / 10;
  const digits = Number.isInteger(sec) ? 0 : 1;
  const secText = sec < 10 ? `0${sec.toFixed(digits)}` : sec.toFixed(digits);
  return h ? `${h}:${String(m).padStart(2, "0")}:${secText}` : `${m}:${secText}`;
}
