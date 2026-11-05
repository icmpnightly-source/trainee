import { filterTrack, samplesOf, smoothTrack, splitsFromSamples, timeAtSamples, trackDistance } from "../../shared/geo.js";

/** Distance covered at time `t`, interpolated in [{ t, d }]. */
function distanceAt(samples, t) {
  if (!samples.length) return 0;
  if (t <= samples[0].t) return samples[0].d;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t >= t) {
      const span = samples[i].t - samples[i - 1].t;
      const f = span > 0 ? (t - samples[i - 1].t) / span : 0;
      return samples[i - 1].d + f * (samples[i].d - samples[i - 1].d);
    }
  }
  return samples[samples.length - 1].d;
}

/**
 * Turns the GPS fixes of a run into a result. The distance and the time at
 * the target distance come from map matching on the local OSRM when that is
 * trustworthy, from the (smoothed) GPS track otherwise.
 */
export async function analyzeRun({ points, targetDistance = null, osrm = null }) {
  const warnings = [];
  const filtered = filterTrack(points ?? []);
  if (filtered.length < 2) {
    return { ok: false, error: "GPS nuqtalari yetarli emas", pointsIn: points?.length ?? 0, pointsUsed: filtered.length };
  }
  const t0 = filtered[0].t;
  const tEnd = filtered[filtered.length - 1].t;
  // What the phone shows live (it does not smooth); the ratio to it corrects the live distance.
  const gpsDistance = trackDistance(filtered);
  const gpsSamples = samplesOf(smoothTrack(filtered, 3));
  const smoothDistance = gpsSamples[gpsSamples.length - 1].d;

  let matched = null;
  let osrmError = null;
  if (osrm) {
    try {
      matched = await osrm.match(filtered);
    } catch (err) {
      osrmError = err.message;
    }
  } else {
    osrmError = "OSRM sozlanmagan";
  }

  let samples = gpsSamples;
  let distanceSource = "gps";
  if (matched && matched.distance > 0 && matched.samples?.length >= 2) {
    const ratio = matched.distance / smoothDistance;
    if (matched.unmatchedChunks > 0) {
      warnings.push("Trekning bir qismi xaritadagi yo'llarga mos kelmadi — GPS bo'yicha hisoblandi");
    } else if (matched.confidence < 0.2) {
      warnings.push(`Xaritaga moslik ishonchi past (${Math.round(matched.confidence * 100)}%) — GPS bo'yicha hisoblandi`);
    } else if (ratio > 1.15 || ratio < 0.4) {
      // GPS noise makes a track longer, never much shorter: a much longer map path means the run left the mapped paths.
      warnings.push("Xaritadagi yo'l GPS trekidan juda farq qiladi (xaritada yo'q yo'lak yoki stadion?) — GPS bo'yicha hisoblandi");
    } else {
      distanceSource = "osrm";
      // Before the first and after the last matched fix, count the GPS distance.
      const first = matched.samples[0];
      const last = matched.samples[matched.samples.length - 1];
      const lead = distanceAt(gpsSamples, first.t);
      // Where OSRM could not place some fixes (a U-turn, an unmapped bit) it either split the
      // trace and bridged it straight, or skipped them and took the shortest way between the
      // fixes around. If the GPS saw the runner go clearly further in that time, count that.
      const pieces = matched.samples.slice(1).map((s, i) => {
        const prev = matched.samples[i];
        const inc = s.d - prev.d;
        const seen = distanceAt(gpsSamples, s.t) - distanceAt(gpsSamples, prev.t);
        const split = s.gap !== undefined && seen > inc;
        const skipped = s.t - prev.t >= 8000 && seen > inc + Math.max(20, 0.3 * inc);
        return { inc, seen, missed: split || skipped };
      });
      // GPS noise inflates what the GPS "saw"; the matched stretches tell by how much.
      const ok = pieces.filter((p) => !p.missed);
      const okSeen = ok.reduce((a, p) => a + p.seen, 0);
      const k = okSeen > 0 ? Math.min(1, ok.reduce((a, p) => a + p.inc, 0) / okSeen) : 1;
      let extra = 0;
      const fixed = matched.samples.map((s, i) => {
        const p = pieces[i - 1];
        if (p?.missed) extra += Math.max(0, p.seen * k - p.inc);
        return { t: s.t, d: s.d + lead + extra };
      });
      if (extra > 50) warnings.push(`${Math.round(extra)} m xaritaga moslanmagan joylarda GPS bo'yicha hisoblandi`);
      samples = [...(first.t > t0 ? [{ t: t0, d: 0 }] : []), ...fixed];
      if (tEnd > last.t) samples.push({ t: tEnd, d: last.d + lead + extra + (smoothDistance - distanceAt(gpsSamples, last.t)) });
    }
  } else if (osrmError) {
    warnings.push(`Xaritaga moslab bo'lmadi (${osrmError}) — GPS bo'yicha hisoblandi`);
  } else if (matched) {
    warnings.push("Trek xaritadagi yo'llarga mos kelmadi — GPS bo'yicha hisoblandi");
  }

  const distance = samples[samples.length - 1].d;
  const elapsedMs = tEnd - t0;
  const avgSpeed = elapsedMs > 0 ? distance / (elapsedMs / 1000) : 0;
  if (avgSpeed > 7) warnings.push("O'rtacha tezlik juda yuqori (> 25 km/soat) — natijani tekshiring");
  const targetMs = targetDistance ? timeAtSamples(samples, targetDistance) : null;
  if (targetDistance && targetMs == null) warnings.push(`Maqsad masofa (${targetDistance} m) bosib o'tilmadi`);

  return {
    ok: true,
    pointsIn: points.length,
    pointsUsed: filtered.length,
    startedAt: new Date(t0).toISOString(),
    elapsedMs,
    gpsDistance,
    smoothDistance,
    matchedDistance: matched?.distance ?? null,
    matchConfidence: matched?.confidence ?? null,
    distance,
    distanceSource,
    /** Multiply the phone's live distance by this to get the corrected one. */
    scale: gpsDistance > 0 ? distance / gpsDistance : 1,
    targetDistance,
    completed: targetDistance ? targetMs != null : null,
    resultSeconds: targetMs != null ? Math.round(targetMs / 100) / 10 : null,
    avgPaceSecPerKm: distance > 0 ? elapsedMs / 1000 / (distance / 1000) : null,
    splits: splitsFromSamples(samples, 1000),
    matchedLines: matched?.lines ?? [],
    track: filtered.map((p) => [p.lon, p.lat, p.t]),
    warnings,
  };
}
