import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DrawingUtils } from "@mediapipe/tasks-vision";
import { type Athlete, post } from "../api";
import { useApi } from "../hooks";
import { keepScreenOn } from "../platform";
import { loadLandmarker, type ModelKind, PoseLandmarker } from "../pose/landmarker";
import { PullupCounter, type PullupState } from "../pose/pullup";

type Source = "camera" | "file";

const PHASE: Record<string, string> = { off: "Turnikda emas", hang: "Osilib turibdi", pull: "Tortilmoqda", top: "Yuqorida", lower: "Tushmoqda" };

function beep(freq: number, ms = 120) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
    osc.onended = () => ctx.close();
  } catch {
    /* no audio */
  }
}

export function PullupPage() {
  const { id } = useParams();
  const athlete = useApi<Athlete>(id ? `/api/athletes/${id}` : null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const counter = useRef(new PullupCounter());
  const stream = useRef<MediaStream | null>(null);
  const loop = useRef<number | null>(null);
  const startedAt = useRef<number>(0);
  const lastValid = useRef(0);
  const lastInvalid = useRef(0);
  const releaseScreen = useRef<() => void>(() => {});

  const [source, setSource] = useState<Source>("camera");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [model, setModel] = useState<ModelKind>("lite");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<PullupState>(counter.current.state);
  const [fps, setFps] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => () => stop(), []);

  function stop() {
    if (loop.current != null) cancelAnimationFrame(loop.current);
    loop.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    video.current?.pause();
    releaseScreen.current();
    releaseScreen.current = () => {};
    setRunning(false);
  }

  async function start(file?: File) {
    setError(null);
    setSaved(null);
    stop();
    const v = video.current!;
    try {
      setStatus("Model yuklanmoqda (lokal)…");
      const { landmarker, delegate } = await loadLandmarker(model);
      if (file) {
        v.srcObject = null;
        v.src = URL.createObjectURL(file);
        v.loop = false;
        v.muted = true;
      } else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Kamera mavjud emas (sahifa HTTPS orqali ochilganmi?)");
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        v.src = "";
        v.srcObject = stream.current;
      }
      await v.play();
      setStatus(`Model: pose_landmarker_${model} · ${delegate}`);
      counter.current.reset();
      lastValid.current = 0;
      lastInvalid.current = 0;
      setState(counter.current.state);
      startedAt.current = performance.now();
      releaseScreen.current = await keepScreenOn();
      setRunning(true);
      run(landmarker);
    } catch (e) {
      setStatus("");
      setError((e as Error).message);
      stop();
    }
  }

  function run(landmarker: PoseLandmarker) {
    const v = video.current!;
    const c = canvas.current!;
    const ctx = c.getContext("2d")!;
    const draw = new DrawingUtils(ctx);
    let lastVideoTime = -1;
    let frames = 0;
    let fpsAt = performance.now();
    let lastTs = 0;

    const tick = () => {
      if (v.ended) {
        stop();
        setStatus("Video tugadi");
        return;
      }
      if (v.readyState >= 2 && v.currentTime !== lastVideoTime) {
        lastVideoTime = v.currentTime;
        if (c.width !== v.videoWidth) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
        }
        // MediaPipe wants strictly increasing timestamps.
        const ts = Math.max(lastTs + 1, performance.now());
        lastTs = ts;
        const res = landmarker.detectForVideo(v, ts);
        const lm = res.landmarks[0];
        // For a file, time is the video's own clock, so slow processing does not stretch reps.
        const t = v.srcObject ? ts : v.currentTime * 1000;
        const s = counter.current.update(lm, t, v.videoWidth / (v.videoHeight || 1));
        if (s.valid > lastValid.current) soundRef.current && beep(880);
        if (s.invalid > lastInvalid.current) soundRef.current && beep(220, 250);
        lastValid.current = s.valid;
        lastInvalid.current = s.invalid;
        setState(s);

        ctx.clearRect(0, 0, c.width, c.height);
        if (lm) {
          draw.drawConnectors(lm, PoseLandmarker.POSE_CONNECTIONS, { color: "#22c55e", lineWidth: 4 });
          draw.drawLandmarks(lm, { color: "#f97316", radius: 3 });
          // The bar line, from the hands.
          const wy = ((lm[15].y + lm[16].y) / 2) * c.height;
          ctx.strokeStyle = "rgba(59,130,246,.8)";
          ctx.setLineDash([10, 8]);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(0, wy);
          ctx.lineTo(c.width, wy);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        frames++;
        const now = performance.now();
        if (now - fpsAt > 1000) {
          setFps(Math.round((frames * 1000) / (now - fpsAt)));
          frames = 0;
          fpsAt = now;
        }
      }
      loop.current = requestAnimationFrame(tick);
    };
    loop.current = requestAnimationFrame(tick);
  }

  async function save() {
    if (!id) return;
    const s = counter.current.state;
    try {
      await post(`/api/athletes/${id}/results`, {
        exercise_id: "pullup",
        value: s.valid,
        source: "pose",
        details: {
          invalid: s.invalid,
          swingWarnings: s.swingWarnings,
          model: `pose_landmarker_${model}`,
          input: source,
          durationMs: Math.round(performance.now() - startedAt.current),
          reps: s.reps,
        },
      });
      setSaved(`Saqlandi: ${s.valid} marta`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const mirrored = source === "camera" && facing === "user";
  const elbow = state.metrics?.elbow;
  const chin = state.metrics?.chinOverBar;

  return (
    <section>
      {id && (
        <Link to={`/athletes/${id}`} className="muted small">
          ← {athlete.data?.name ?? "Sportchi"}
        </Link>
      )}
      <h1>Turnikda tortilish — AI hisoblagich</h1>
      <p className="muted small">
        Kamerani turnikdan 2–4 m uzoqlikka, old tomondan qo'ying: qo'llar, bosh va yelkalar kadrda bo'lsin. Model shu qurilmada ishlaydi, video hech qayerga yuborilmaydi.
      </p>

      <div className="card form inline">
        <select value={source} disabled={running} onChange={(e) => setSource(e.target.value as Source)}>
          <option value="camera">Kamera</option>
          <option value="file">Video fayl</option>
        </select>
        {source === "camera" && (
          <select value={facing} disabled={running} onChange={(e) => setFacing(e.target.value as "user" | "environment")}>
            <option value="environment">Orqa kamera</option>
            <option value="user">Old kamera</option>
          </select>
        )}
        <select value={model} disabled={running} onChange={(e) => setModel(e.target.value as ModelKind)}>
          <option value="lite">Model: lite (tez)</option>
          <option value="full">Model: full (aniqroq)</option>
        </select>
        <label className="check">
          <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Ovoz
        </label>
        {source === "camera" ? (
          running ? (
            <button className="danger" onClick={stop}>
              To'xtatish
            </button>
          ) : (
            <button className="primary" onClick={() => start()}>
              Boshlash
            </button>
          )
        ) : (
          <input type="file" accept="video/*" disabled={running} onChange={(e) => e.target.files?.[0] && start(e.target.files[0])} />
        )}
      </div>

      {status && <p className="muted small">{status}{running ? ` · ${fps} kadr/s` : ""}</p>}
      {error && <p className="error">{error}</p>}

      <div className="pullup">
        <div className={`stage ${mirrored ? "mirror" : ""}`}>
          <video ref={video} playsInline muted />
          <canvas ref={canvas} />
        </div>
        <div className="counter">
          <div className="big">{state.valid}</div>
          <div className="muted">to'g'ri takror</div>
          <div className="invalid">{state.invalid} hisoblanmadi</div>
          <div className={`phase phase-${state.phase}`}>{PHASE[state.phase]}</div>
          <div className="feedback">{state.feedback}</div>
          <div className="muted small">
            Tirsak: {elbow != null ? `${Math.round(elbow)}°` : "—"} · Iyak/turnik: {chin != null ? (chin > 0 ? "yuqorida" : "pastda") : "—"}
            {state.swingWarnings ? ` · tebranish: ${state.swingWarnings}` : ""}
          </div>
          <div className="row">
            <button
              onClick={() => {
                counter.current.reset();
                lastValid.current = 0;
                lastInvalid.current = 0;
                setState(counter.current.state);
                setSaved(null);
              }}
            >
              Qayta boshlash
            </button>
            {id && (
              <button className="primary" disabled={!state.valid && !state.invalid} onClick={save}>
                Natijani saqlash
              </button>
            )}
          </div>
          {saved && <p className="ok-text">{saved}</p>}
          {state.reps.length > 0 && (
            <ol className="reps">
              {state.reps
                .slice()
                .reverse()
                .slice(0, 12)
                .map((r) => (
                  <li key={r.n} className={r.valid ? "ok-text" : "warn-text"}>
                    #{r.n} {r.valid ? "✓" : `✕ ${r.reason}`} · {(r.durationMs / 1000).toFixed(1)} s
                  </li>
                ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}
