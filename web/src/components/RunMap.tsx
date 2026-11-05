import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { MapConfig } from "../api";

export interface RunMapProps {
  config: MapConfig;
  /** Live or recorded GPS track, [lat, lon]. */
  track?: [number, number][];
  /** Map-matched lines from OSRM, [lon, lat]. */
  matched?: [number, number][][];
  /** A planned course from OSRM, [lon, lat]. */
  course?: [number, number][];
  here?: { lat: number; lon: number; acc: number | null } | null;
  follow?: boolean;
  onPick?: (p: { lat: number; lon: number }) => void;
  height?: number | string;
}

const swap = (line: [number, number][]) => line.map(([lon, lat]) => [lat, lon] as [number, number]);

export function RunMap({ config, track, matched, course, here, follow, onPick, height = 360 }: RunMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const fitted = useRef("");

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true }).setView([config.center.lat, config.center.lon], 15);
    L.tileLayer(config.tileUrl, { maxZoom: 19, attribution: config.tileAttribution }).addTo(m);
    layers.current = L.layerGroup().addTo(m);
    m.on("click", (e: L.LeafletMouseEvent) => pick.current?.({ lat: e.latlng.lat, lon: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [config.tileUrl, config.tileAttribution, config.center.lat, config.center.lon]);

  useEffect(() => {
    const m = map.current;
    const g = layers.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    if (course?.length) {
      const ll = swap(course);
      L.polyline(ll, { color: "#7c3aed", weight: 5, opacity: 0.45, dashArray: "8 8" }).addTo(g);
      bounds.push(...ll);
      L.circleMarker(ll[0], { radius: 7, color: "#7c3aed", fillOpacity: 1 }).bindTooltip("Start / marra").addTo(g);
    }
    if (track?.length) {
      L.polyline(track, { color: "#ef4444", weight: 3, opacity: 0.8 }).addTo(g);
      bounds.push(...track);
    }
    for (const line of matched ?? []) {
      const ll = swap(line);
      L.polyline(ll, { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(g);
      bounds.push(...ll);
    }
    if (here) {
      if (here.acc) L.circle([here.lat, here.lon], { radius: here.acc, weight: 1, color: "#0ea5e9", fillOpacity: 0.1 }).addTo(g);
      L.circleMarker([here.lat, here.lon], { radius: 6, color: "#fff", weight: 2, fillColor: "#0ea5e9", fillOpacity: 1 }).addTo(g);
    }
    if (follow && here) {
      m.setView([here.lat, here.lon], Math.max(m.getZoom(), 16), { animate: false });
    } else if (bounds.length > 1) {
      // Fit once per new set of lines, not on every redraw.
      const key = `${course?.length ?? 0}:${matched?.length ?? 0}:${follow ? "" : track?.length ?? 0}`;
      if (key !== fitted.current) {
        fitted.current = key;
        m.fitBounds(L.latLngBounds(bounds), { padding: [24, 24], maxZoom: 17 });
      }
    } else if (here) {
      m.setView([here.lat, here.lon], Math.max(m.getZoom(), 15), { animate: false });
    }
  }, [track, matched, course, here, follow]);

  return <div ref={el} className="map" style={{ height }} />;
}
