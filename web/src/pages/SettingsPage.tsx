import { useState } from "react";
import { Link } from "react-router-dom";
import { get, type Health, put } from "../api";
import { getServerUrl, isNative } from "../platform";
import { useApi } from "../hooks";

export function SettingsPage() {
  const health = useApi<Health>("/api/health");
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function loadModels() {
    setModelsError(null);
    try {
      const out = await get<{ current: string; models: string[] }>("/api/ai/models");
      setModels(out.models);
      setModel(out.current);
    } catch (e) {
      setModelsError((e as Error).message);
    }
  }

  async function saveModel(value: string) {
    const out = await put<{ current: string }>("/api/ai/model", { model: value });
    setMsg(`Model: ${out.current}`);
    health.reload();
  }

  const h = health.data;
  return (
    <section>
      <h1>Sozlamalar va holat</h1>
      {isNative && (
        <div className="card">
          <h2>Server</h2>
          <p className="small">
            <code>{getServerUrl() || "kiritilmagan"}</code> · <Link to="/server">o'zgartirish</Link>
          </p>
        </div>
      )}
      {health.error && <p className="error">{health.error}</p>}
      {h && (
        <>
          <div className="card">
            <h2>AI murabbiy</h2>
            <p className="small">
              API: <code>{h.ai.baseUrl}</code>
              <br />
              Model: <code>{h.ai.model}</code>
              <br />
              Holat: {h.ai.configured ? <span className="ok-text">kalit bor</span> : <span className="error">AI_API_KEY kiritilmagan (server/.env)</span>}
            </p>
            <div className="row">
              <button onClick={loadModels}>Mavjud modellarni olish</button>
              {models && (
                <>
                  <select value={model} onChange={(e) => setModel(e.target.value)}>
                    {!models.includes(model) && <option value={model}>{model}</option>}
                    {models.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                  <button className="primary" onClick={() => saveModel(model)}>
                    Tanlash
                  </button>
                </>
              )}
              <button onClick={() => saveModel("")}>.env dagi modelga qaytish</button>
            </div>
            {modelsError && <p className="error small">{modelsError}</p>}
            {msg && <p className="ok-text small">{msg}</p>}
            <p className="muted small">
              Lokal model uchun (masalan Ollama): <code>AI_BASE_URL=http://127.0.0.1:11434/v1</code> va <code>AI_MODEL=qwen3:8b</code> ni server/.env ga yozing.
            </p>
          </div>

          <div className="card">
            <h2>OSRM (lokal xarita marshrutlash)</h2>
            <p className="small">
              Manzil: <code>{h.osrm.url}</code>
              <br />
              Holat: {h.osrm.ok ? <span className="ok-text">ishlayapti</span> : <span className="error">{h.osrm.error}</span>}
              {h.osrm.ok && h.osrm.distanceFromQuery != null && (
                <>
                  <br />
                  Xarita markazidan eng yaqin yo'l: {Math.round(h.osrm.distanceFromQuery)} m
                  {h.osrm.distanceFromQuery > 5000 && <span className="warn-text"> — yuklangan xarita MAP_CENTER hududini qamramaydi</span>}
                </>
              )}
            </p>
          </div>

          <div className="card small muted">
            Turnik hisoblagichi modeli (MediaPipe Pose Landmarker) brauzerning o'zida, shu serverdan olingan fayllar bilan ishlaydi: <code>/models/pose_landmarker_*.task</code>, <code>/mediapipe/wasm/</code>.
          </div>
        </>
      )}
    </section>
  );
}
