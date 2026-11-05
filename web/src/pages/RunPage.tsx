import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type Athlete, type MapConfig, type Normatives, post, type RunAnalysis } from "../api";
import { RunMap } from "../components/RunMap";
import { formatDuration, formatKm, formatPace } from "../format";
import { useApi } from "../hooks";
import { isNative, keepScreenOn } from "../platform";
import { type Fix, RunTracker, simulateFixes, watchGps } from "../run/tracker";

type Phase = "ready" | "running" | "finished";

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 990;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
    navigator.vibrate?.(400);
  } catch {
    /* no audio */
  }
}

interface Course {
  coordinates: [number, number][];
  distance: number;
}

export function RunPage() {
  const { id } = useParams();
  const athlete = useApi<Athlete>(id ? `/api/athletes/${id}` : null);
  const norms = useApi<Normatives>("/api/normatives");
  const mapConfig = useApi<{ map: MapConfig }>("/api/config");
  const runs = useMemo(() => norms.data?.exercises.filter((e) => e.tracking === "gps" && e.distance) ?? [], [norms.data]);

  const [exerciseId, setExerciseId] = useState<string>("");
  const exercise = runs.find((e) => e.id === exerciseId) ?? runs[0];
  const target = exercise?.distance ?? 1000;

  const [here, setHere] = useState<Fix | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("ready");
  const [now, setNow] = useState(Date.now());
  const [trackLine, setTrackLine] = useState<[number, number][]>([]);
  const [analysis, setAnalysis] = useState<RunAnalysis | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [simSpeed, setSimSpeed] = useState(3.6);
  const [simulated, setSimulated] = useState(false);

  const tracker = useRef<RunTracker | null>(null);
  const releaseLock = useRef<() => void>(() => {});
  const simTimer = useRef<number | null>(null);

  // GPS runs from the moment the page opens, so there is a fix before the start.
  useEffect(() => {
    const stop = watchGps(
      (f) => {
        setGpsError(null);
        setHere(f);
        const t = tracker.current;
        if (t && t.startedAt != null && t.finishedMs == null && !simulated) {
          t.add(f);
          setTrackLine(t.kept.map((p) => [p.lat, p.lon]));
        }
      },
      (msg) => setGpsError(msg),
    );
    return stop;
  }, [simulated]);

  useEffect(() => {
    // A simulation moves the clock itself, with the fixes.
    if (phase !== "running" || simulated) return;
    const i = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(i);
  }, [phase, simulated]);

  useEffect(
    () => () => {
      releaseLock.current();
      if (simTimer.current) clearInterval(simTimer.current);
    },
    [],
  );

  const stats = tracker.current?.stats(now);
  const verifying = useRef(false);

  // Every 20 s the server map-matches the run so far, so the live distance shown is the corrected one.
  useEffect(() => {
    if (phase !== "running") return;
    const i = setInterval(() => tracker.current && verify(tracker.current, false), simulated ? 2000 : 20000);
    return () => clearInterval(i);
  }, [phase, simulated]);

  function begin(sim: boolean, from: Fix) {
    setAnalysis(null);
    setSaved(null);
    setError(null);
    setSimulated(sim);
    const t = new RunTracker(target);
    t.onTarget = () => verify(t, true);
    t.start(from.t, from);
    tracker.current = t;
    setTrackLine([[from.lat, from.lon]]);
    setPhase("running");
    setNow(Date.now());
  }

  async function startReal() {
    if (!here) return;
    // The app records with the screen off; a browser page needs the screen on.
    if (!isNative) releaseLock.current = await keepScreenOn();
    begin(false, { ...here, t: Date.now() });
  }

  async function startSimulation() {
    setError(null);
    let c = course;
    if (!c) c = await buildCourse();
    if (!c) return;
    // Twice round the course, so there is room to run on if the map says the GPS was long.
    const fixes = simulateFixes([...c.coordinates, ...c.coordinates.slice(1)], simSpeed, Date.now());
    begin(true, fixes[0]);
    let i = 1;
    // Ten seconds of running per real second.
    simTimer.current = window.setInterval(() => {
      const t = tracker.current;
      if (!t || t.finishedMs != null || i >= fixes.length) {
        if (simTimer.current) clearInterval(simTimer.current);
        if (t && t.finishedMs == null) stopRun(t);
        return;
      }
      t.add(fixes[i]);
      setHere(fixes[i]);
      setNow(fixes[i].t);
      setTrackLine(t.kept.map((p) => [p.lat, p.lon]));
      i++;
    }, 100);
  }

  /**
   * Asks the server (local OSRM) about the run so far. With `atTarget`, the
   * phone thinks the distance is covered: the run ends only if the server
   * agrees; otherwise the corrected distance shows how much is left.
   */
  async function verify(t: RunTracker, atTarget: boolean) {
    if (verifying.current || t.finishedMs != null) return;
    verifying.current = true;
    try {
      const a = await post<RunAnalysis>("/api/runs/analyze", { exercise_id: exercise?.id, points: t.all });
      if (t.finishedMs != null) return;
      if (a.ok && a.scale) t.setScale(a.scale);
      if (a.ok && a.completed && a.resultSeconds != null) {
        end(t, a);
        return;
      }
      if (atTarget) t.rearm();
    } catch (e) {
      // No server: finish on the phone's own distance, and say so.
      if (atTarget) {
        setError(`Server bilan tekshirib bo'lmadi: ${(e as Error).message}`);
        end(t, null);
      }
    } finally {
      verifying.current = false;
    }
  }

  function end(t: RunTracker, a: RunAnalysis | null) {
    if (simTimer.current) clearInterval(simTimer.current);
    releaseLock.current();
    t.finish(a?.resultSeconds != null ? a.resultSeconds * 1000 : Date.now() - (t.startedAt ?? Date.now()));
    setAnalysis(a);
    setPhase("finished");
    beep();
  }

  /** The runner pressed stop (or the simulation ran out): final check of what was run. */
  async function stopRun(t: RunTracker) {
    if (simTimer.current) clearInterval(simTimer.current);
    releaseLock.current();
    setBusy("Natija lokal OSRM orqali tekshirilmoqda…");
    try {
      const a = await post<RunAnalysis>("/api/runs/analyze", { exercise_id: exercise?.id, points: t.all });
      t.finish(a.resultSeconds != null ? a.resultSeconds * 1000 : (t.all.at(-1)?.t ?? 0) - (t.startedAt ?? 0));
      setAnalysis(a);
      if (!a.ok) setError(a.error ?? "Tahlil xatosi");
    } catch (e) {
      t.finish(Date.now() - (t.startedAt ?? Date.now()));
      setError((e as Error).message);
    } finally {
      setPhase("finished");
      setBusy(null);
    }
  }

  async function save() {
    const t = tracker.current;
    if (!t || !id || !exercise) return;
    setBusy("Saqlanmoqda…");
    try {
      const out = await post<{ result: { value: number }; analysis: RunAnalysis }>(`/api/athletes/${id}/runs`, { exercise_id: exercise.id, points: t.all });
      setSaved(`Saqlandi: ${formatDuration(out.result.value)}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function buildCourse(): Promise<Course | null> {
    const from = picked ?? here ?? mapConfig.data?.map.center;
    if (!from) return null;
    setBusy("Marshrut tuzilmoqda (OSRM)…");
    setError(null);
    try {
      const c = await post<Course>("/api/osrm/loop", { lat: from.lat, lon: from.lon, distance: target, bearing: Math.round(Math.random() * 360) });
      setCourse(c);
      return c;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (!mapConfig.data || !norms.data) return <p className="muted">Yuklanmoqda…</p>;
  const remaining = stats ? Math.max(0, target - stats.distance) : target;
  const gpsOk = here && (here.acc ?? 99) <= 30;

  return (
    <section>
      {id && (
        <Link to={`/athletes/${id}`} className="muted small">
          ← {athlete.data?.name ?? "Sportchi"}
        </Link>
      )}
      <h1>Yugurish — GPS treking</h1>

      <div className="card form inline">
        <select value={exercise?.id ?? ""} disabled={phase === "running"} onChange={(e) => (setExerciseId(e.target.value), setCourse(null))}>
          {runs.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
        <span className={`badge ${gpsOk ? "ok" : "warn"}`}>{here ? `GPS ±${Math.round(here.acc ?? 0)} m` : "GPS kutilmoqda…"}</span>
        {phase !== "running" ? (
          <button className="primary" disabled={!here} onClick={startReal} title={gpsOk ? "" : "GPS aniqligi past"}>
            ▶ Start
          </button>
        ) : (
          <button className="danger" onClick={() => tracker.current && stopRun(tracker.current)}>
            ■ To'xtatish
          </button>
        )}
      </div>
      {gpsError && <p className="error">{gpsError}</p>}
      {here && !gpsOk && phase === "ready" && <p className="warn-text small">GPS aniqligi past — ochiq joyda bir oz kuting.</p>}

      <div className="stats run">
        <div>
          <b>{formatDuration((stats?.elapsedMs ?? 0) / 1000)}</b>
          <span>vaqt</span>
        </div>
        <div>
          <b>{formatKm(stats?.distance ?? 0)}</b>
          <span>masofa / {formatKm(target)}</span>
        </div>
        <div>
          <b>{formatKm(remaining)}</b>
          <span>qoldi</span>
        </div>
        <div>
          <b>{formatPace(stats?.currentPace)}</b>
          <span>joriy sur'at</span>
        </div>
        <div>
          <b>{formatPace(stats?.avgPace)}</b>
          <span>o'rtacha sur'at</span>
        </div>
      </div>

      <RunMap
        config={mapConfig.data.map}
        here={here}
        track={trackLine}
        matched={analysis?.matchedLines}
        course={course?.coordinates}
        follow={phase === "running"}
        onPick={phase === "running" ? undefined : setPicked}
      />
      <p className="muted small">
        <span style={{ color: "#ef4444" }}>━</span> GPS trek · <span style={{ color: "#2563eb" }}>━</span> OSRM xaritaga moslangan · <span style={{ color: "#7c3aed" }}>┅</span> rejalashtirilgan marshrut
        {tracker.current && tracker.current.scale !== 1 ? ` · masofa OSRM bo'yicha tuzatilgan (×${tracker.current.scale.toFixed(3)})` : ""}
        {picked && phase !== "running" ? ` · tanlangan nuqta: ${picked.lat.toFixed(5)}, ${picked.lon.toFixed(5)}` : ""}
      </p>

      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {analysis?.ok && (
        <div className="card">
          <h2>Natija {simulated && <span className="badge warn">simulyatsiya</span>}</h2>
          <div className="stats">
            <div>
              <b>{analysis.resultSeconds != null ? formatDuration(analysis.resultSeconds) : "—"}</b>
              <span>{formatKm(target)} vaqti</span>
            </div>
            <div>
              <b>{formatKm(analysis.distance)}</b>
              <span>{analysis.distanceSource === "osrm" ? "OSRM bilan tekshirilgan" : "GPS bo'yicha"}</span>
            </div>
            <div>
              <b>{formatKm(analysis.gpsDistance)}</b>
              <span>xom GPS</span>
            </div>
            <div>
              <b>{analysis.matchConfidence != null ? `${Math.round(analysis.matchConfidence * 100)}%` : "—"}</b>
              <span>xaritaga moslik</span>
            </div>
            <div>
              <b>{formatPace(analysis.avgPaceSecPerKm)}</b>
              <span>o'rtacha sur'at</span>
            </div>
          </div>
          {analysis.splits.length > 0 && (
            <p className="small">
              Kilometrlar: {analysis.splits.map((s, i) => `${i + 1}-km ${formatDuration(Math.round(s.splitMs / 1000))}`).join(" · ")}
            </p>
          )}
          {analysis.warnings.map((w) => (
            <p key={w} className="warn-text small">
              ⚠ {w}
            </p>
          ))}
          {id && !simulated && analysis.completed && (
            <button className="primary" onClick={save} disabled={Boolean(saved)}>
              Natijani saqlash
            </button>
          )}
          {simulated && <p className="muted small">Simulyatsiya natijasi sportchi tarixiga saqlanmaydi.</p>}
          {saved && <p className="ok-text">{saved}</p>}
        </div>
      )}

      <details className="card">
        <summary>Marshrut va sinov rejimi</summary>
        <p className="muted small">
          Xaritada nuqtani bosing (yoki joriy joylashuv ishlatiladi) — lokal OSRM shu yerdan boshlanib shu yerda tugaydigan {formatKm(target)} lik piyoda marshrut tuzadi.
        </p>
        <div className="row">
          <button onClick={buildCourse} disabled={phase === "running"}>
            Aylana marshrut tuzish
          </button>
          {course && <span className="small">Marshrut: {formatKm(course.distance)}</span>}
        </div>
        <p className="muted small">Sinov rejimi: tashqariga chiqmasdan ekranlarni sinash uchun marshrut bo'ylab soxta GPS nuqtalari (10× tezlikda).</p>
        <div className="row">
          <label className="small">
            Tezlik (m/s){" "}
            <input type="number" min={1.5} max={8} step={0.1} value={simSpeed} onChange={(e) => setSimSpeed(Number(e.target.value))} style={{ width: 80 }} />
          </label>
          <span className="muted small">= {formatPace(1000 / simSpeed)}</span>
          <button onClick={startSimulation} disabled={phase === "running"}>
            Simulyatsiya
          </button>
        </div>
      </details>
    </section>
  );
}
