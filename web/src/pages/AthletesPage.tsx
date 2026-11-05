import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type Athlete, post } from "../api";
import { useApi } from "../hooks";
import { AthleteForm, type AthleteDraft, emptyDraft } from "./AthleteForm";

export function AthletesPage() {
  const { data, error, loading, reload } = useApi<Athlete[]>("/api/athletes");
  const [adding, setAdding] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function create(d: AthleteDraft) {
    setSaveError(null);
    try {
      const a = await post<Athlete>("/api/athletes", d);
      reload();
      navigate(`/athletes/${a.id}`);
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  return (
    <section>
      <div className="row between">
        <h1>Sportchilar</h1>
        {!adding && (
          <button className="primary" onClick={() => setAdding(true)}>
            + Sportchi qo'shish
          </button>
        )}
      </div>

      {adding && (
        <div className="card">
          <h2>Yangi sportchi</h2>
          <AthleteForm initial={emptyDraft()} onSubmit={create} onCancel={() => setAdding(false)} submitText="Qo'shish" />
          {saveError && <p className="error">{saveError}</p>}
        </div>
      )}

      {loading && <p className="muted">Yuklanmoqda…</p>}
      {error && <p className="error">{error}</p>}
      {data && !data.length && !adding && <p className="muted">Hali sportchi yo'q. Birinchisini qo'shing.</p>}

      <div className="list">
        {data?.map((a) => (
          <Link key={a.id} to={`/athletes/${a.id}`} className="card link">
            <div className="row between">
              <strong>{a.name}</strong>
              {a.passedAll ? <span className="badge ok">Hammasi topshirildi</span> : a.missing ? <span className="badge">{a.missing} ta natija yo'q</span> : <span className="badge warn">Tayyorlanmoqda</span>}
            </div>
            <div className="muted small">
              {a.gender === "male" ? "Erkak" : "Ayol"} · {a.age ?? "—"} yosh · guruh {a.ageGroup ?? "—"}
              {a.height_cm ? ` · ${a.height_cm} sm` : ""}
              {a.weight_kg ? ` · ${a.weight_kg} kg` : ""}
            </div>
          </Link>
        ))}
      </div>

      <div className="card muted small">
        Sportchisiz sinab ko'rish: <Link to="/pullup">turnik hisoblagichi</Link> · <Link to="/run">yugurish trekeri</Link>
      </div>
    </section>
  );
}
