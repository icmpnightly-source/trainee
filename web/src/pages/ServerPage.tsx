import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Health } from "../api";
import { getServerUrl, normalizeServerUrl, setServerUrl } from "../platform";

/** Android app: which NormativAI server to use (it holds the data, the AI key and OSRM). */
export function ServerPage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState(getServerUrl() || "http://192.168.1.");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setHealth(null);
    const server = normalizeServerUrl(url);
    try {
      const h = await api<Health>("GET", "/api/health", undefined, server);
      setHealth(h);
      setServerUrl(server);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Serverga ulanish</h1>
      <p className="muted small">
        Sportchilar, natijalar, AI murabbiy va xarita (OSRM) NormativAI serverida turadi. Server ishlayotgan kompyuterning lokal tarmoqdagi manzilini kiriting —
        telefon shu Wi-Fi tarmog'ida bo'lsin. Masalan: <code>192.168.1.20:8080</code>
      </p>
      <form className="card form inline" onSubmit={check}>
        <input inputMode="url" autoCapitalize="off" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="192.168.1.20:8080" />
        <button className="primary" disabled={busy}>
          {busy ? "Tekshirilmoqda…" : "Ulanish"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {health && (
        <div className="card">
          <p className="ok-text">✓ Server topildi va saqlandi</p>
          <p className="small">
            AI: {health.ai.configured ? `${health.ai.model}` : <span className="warn-text">kalit kiritilmagan</span>}
            <br />
            OSRM: {health.osrm.ok ? "ishlayapti" : <span className="warn-text">{health.osrm.error}</span>}
          </p>
          <button className="primary" onClick={() => navigate("/")}>
            Davom etish
          </button>
        </div>
      )}
      <p className="muted small">Turnik hisoblagichi serversiz ham ishlaydi (model telefonning o'zida), lekin natijani saqlash uchun server kerak.</p>
    </section>
  );
}
