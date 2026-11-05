import { Link, useParams } from "react-router-dom";
import type { MapConfig, Result } from "../api";
import { RunMap } from "../components/RunMap";
import { formatDateTime, formatDuration, formatKm, formatPace } from "../format";
import { useApi } from "../hooks";

interface Track {
  raw: [number, number, number][];
  matched: [number, number][][] | null;
}

export function TrackPage() {
  const { id, resultId } = useParams();
  const track = useApi<Track>(`/api/results/${resultId}/track`);
  const results = useApi<Result[]>(`/api/athletes/${id}/results`);
  const mapConfig = useApi<{ map: MapConfig }>("/api/config");
  const result = results.data?.find((r) => String(r.id) === resultId);
  const d = (result?.details ?? {}) as Record<string, number | string | null | undefined>;

  if (track.error) return <p className="error">{track.error}</p>;
  if (!track.data || !mapConfig.data) return <p className="muted">Yuklanmoqda…</p>;
  return (
    <section>
      <Link to={`/athletes/${id}`} className="muted small">
        ← Sportchi
      </Link>
      <h1>Yugurish treki</h1>
      {result && (
        <div className="stats">
          <div>
            <b>{formatDuration(result.value)}</b>
            <span>natija</span>
          </div>
          <div>
            <b>{formatKm(Number(d.distance))}</b>
            <span>{d.distanceSource === "osrm" ? "OSRM bilan tekshirilgan" : "GPS bo'yicha"}</span>
          </div>
          <div>
            <b>{formatPace(Number(d.avgPaceSecPerKm))}</b>
            <span>o'rtacha sur'at</span>
          </div>
          <div>
            <b>{formatDateTime(result.recorded_at)}</b>
            <span>sana</span>
          </div>
        </div>
      )}
      <RunMap config={mapConfig.data.map} track={track.data.raw.map(([lon, lat]) => [lat, lon])} matched={track.data.matched ?? []} height={460} />
    </section>
  );
}
