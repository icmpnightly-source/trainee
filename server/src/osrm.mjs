// Client for a local OSRM server (osrm-routed): map matching for recorded
// runs, routing between points, and loop courses of a set length.
import { destination, downsample, haversine, lineLength } from "../../shared/geo.js";

export class OsrmError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
    this.status = 502;
  }
}

const coordText = (points) => points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

export function createOsrm({ baseUrl, profile = "foot", chunkSize = 100, timeoutMs = 15000, fetchImpl = fetch }) {
  async function call(service, points, params = {}) {
    const query = new URLSearchParams(params).toString();
    const url = `${baseUrl}/${service}/v1/${profile}/${coordText(points)}${query ? `?${query}` : ""}`;
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new OsrmError(`OSRM serveriga ulanib bo'lmadi (${baseUrl}): ${err.cause?.code ?? err.message}`, "Unreachable");
    }
    let body;
    try {
      body = await res.json();
    } catch {
      throw new OsrmError(`OSRM javobi JSON emas (HTTP ${res.status})`, "BadResponse");
    }
    return body;
  }

  return {
    baseUrl,

    /** Responds with where the loaded map is, or throws when OSRM is down. */
    async status(near = { lat: 0, lon: 0 }) {
      const body = await call("nearest", [near], { number: 1 });
      if (body.code !== "Ok") throw new OsrmError(body.message ?? body.code, body.code);
      const [lon, lat] = body.waypoints[0].location;
      return { ok: true, nearest: { lat, lon }, distanceFromQuery: body.waypoints[0].distance };
    },

    /**
     * Snaps a GPS trace to the paths of the map. Long traces go in chunks
     * (osrm-routed accepts 100 points per request by default), each sharing
     * its first point with the end of the previous one.
     *
     * Besides the total, returns `samples`: the matched distance covered at
     * the time of every matched fix, so the time at any distance can be read
     * off the map rather than off the GPS zigzag.
     */
    async match(points) {
      const trace = downsample(points, 5, 1);
      if (trace.length < 2) return null;
      const lines = [];
      const samples = [];
      let cum = 0;
      let weighted = 0;
      let matchedOnly = 0;
      let gapDistance = 0;
      let unmatchedChunks = 0;
      let lastLoc = null;
      const step = Math.max(2, chunkSize) - 1;
      for (let start = 0; start < trace.length - 1; start += step) {
        const chunk = trace.slice(start, start + step + 1);
        if (chunk.length < 2) break;
        // OSRM wants strictly increasing whole seconds.
        const stamps = [];
        const usable = [];
        for (const p of chunk) {
          const s = Math.round(p.t / 1000);
          if (stamps.length && s <= stamps[stamps.length - 1]) continue;
          stamps.push(s);
          usable.push(p);
        }
        if (usable.length < 2) continue;
        const body = await call("match", usable, {
          timestamps: stamps.join(";"),
          radiuses: usable.map((p) => Math.min(50, Math.max(5, Math.round(p.acc ?? 15)))).join(";"),
          geometries: "geojson",
          overview: "full",
          gaps: "split",
          tidy: "true",
        });
        if (body.code === "NoMatch" || body.code === "NoSegment") {
          unmatchedChunks += 1;
          continue;
        }
        if (body.code !== "Ok") throw new OsrmError(body.message ?? body.code, body.code);
        body.matchings.forEach((m, mi) => {
          const waypoints = body.tracepoints
            .map((tp, k) => tp && tp.matchings_index === mi && { k, w: tp.waypoint_index, loc: { lon: tp.location[0], lat: tp.location[1] } })
            .filter(Boolean)
            .sort((a, b) => a.w - b.w);
          waypoints.forEach((wp, j) => {
            let gap;
            if (j === 0) {
              // A new piece: where OSRM split the trace (or a new chunk starts), bridge the gap straight.
              // The caller may know better (the GPS saw the runner go further): `gap` marks it.
              if (lastLoc) {
                gap = haversine(lastLoc, wp.loc);
                cum += gap;
                gapDistance += gap;
              }
            } else {
              cum += m.legs[j - 1]?.distance ?? haversine(waypoints[j - 1].loc, wp.loc);
            }
            const t = usable[wp.k].t;
            if (!samples.length || t > samples[samples.length - 1].t) samples.push(gap === undefined ? { t, d: cum } : { t, d: cum, gap });
            lastLoc = wp.loc;
          });
          matchedOnly += m.distance;
          weighted += m.confidence * m.distance;
          lines.push(m.geometry.coordinates);
        });
      }
      return {
        distance: cum,
        confidence: matchedOnly > 0 ? weighted / matchedOnly : 0,
        lines,
        samples,
        gapDistance,
        unmatchedChunks,
        pointsSent: trace.length,
      };
    },

    /** Walking route through the points in order. */
    async route(points) {
      if (points.length < 2) throw new OsrmError("Kamida ikkita nuqta kerak", "InvalidInput");
      const body = await call("route", points, { overview: "full", geometries: "geojson", steps: "false" });
      if (body.code !== "Ok") throw new OsrmError(body.message ?? body.code, body.code);
      const r = body.routes[0];
      return { distance: r.distance, duration: r.duration, coordinates: r.geometry.coordinates };
    },

    /**
     * A course that starts and ends at `start` and is about `target` metres
     * long: three points on a circle through the start, routed in order,
     * with the circle resized until the route length fits.
     */
    async loop(start, target, bearing = 0) {
      let radius = target / (2 * Math.PI) / 1.25;
      let best = null;
      for (let i = 0; i < 7; i++) {
        const center = destination(start, bearing, radius);
        const ring = [60, 180, 300].map((a) => destination(center, (bearing + 180 + a) % 360, radius));
        let route;
        try {
          route = await this.route([start, ...ring, start]);
        } catch (err) {
          if (err.code === "Unreachable") throw err;
          radius *= 0.8;
          continue;
        }
        const error = Math.abs(route.distance - target) / target;
        if (!best || error < best.error) best = { ...route, error, waypoints: [start, ...ring, start] };
        if (error < 0.05) break;
        radius *= Math.min(1.6, Math.max(0.6, target / route.distance));
      }
      if (!best) throw new OsrmError("Bu joydan marshrut tuzib bo'lmadi", "NoRoute");
      return { ...best, length: lineLength(best.coordinates) };
    },
  };
}
