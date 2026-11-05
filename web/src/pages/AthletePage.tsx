import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { type Assessment, type Athlete, del, type Normatives, post, put, type Result } from "../api";
import { formatDate, formatDateTime, formatGap, formatValue, GRADE_NAMES, parseTime } from "../format";
import { useApi } from "../hooks";
import { AthleteForm, type AthleteDraft, draftOf } from "./AthleteForm";

const SOURCE: Record<string, string> = { manual: "qo'lda", pose: "AI kamera", gps: "GPS" };

function GradeBadge({ grade }: { grade: number | null }) {
  if (grade == null) return <span className="badge">—</span>;
  const cls = grade >= 4 ? "ok" : grade === 3 ? "warn" : "bad";
  return <span className={`badge ${cls}`}>{grade ? `${grade} · ${GRADE_NAMES[grade]}` : GRADE_NAMES[0]}</span>;
}

export function AthletePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const athlete = useApi<Athlete>(`/api/athletes/${id}`);
  const assessment = useApi<Assessment>(`/api/athletes/${id}/assessment`);
  const results = useApi<Result[]>(`/api/athletes/${id}/results`);
  const norms = useApi<Normatives>("/api/normatives");
  const [editing, setEditing] = useState(false);
  const [entry, setEntry] = useState({ exercise_id: "", value: "" });
  const [entryError, setEntryError] = useState<string | null>(null);

  const reloadAll = () => {
    athlete.reload();
    assessment.reload();
    results.reload();
  };

  if (athlete.error) return <p className="error">{athlete.error}</p>;
  const a = athlete.data;
  const s = assessment.data;
  if (!a || !s || !norms.data) return <p className="muted">Yuklanmoqda…</p>;
  const exById = Object.fromEntries(norms.data.exercises.map((e) => [e.id, e]));
  const entryEx = exById[entry.exercise_id];

  async function save(d: AthleteDraft) {
    await put(`/api/athletes/${id}`, d);
    setEditing(false);
    reloadAll();
  }

  async function addResult(e: React.FormEvent) {
    e.preventDefault();
    setEntryError(null);
    const value = entryEx?.unit === "soniya" ? parseTime(entry.value) : Number(entry.value.replace(",", "."));
    if (value == null || !Number.isFinite(value)) return setEntryError("Natija noto'g'ri (vaqt uchun 13:45 yoki 14.2)");
    try {
      await post(`/api/athletes/${id}/results`, { exercise_id: entry.exercise_id, value, source: "manual" });
      setEntry({ exercise_id: entry.exercise_id, value: "" });
      reloadAll();
    } catch (err) {
      setEntryError((err as Error).message);
    }
  }

  return (
    <section>
      <Link to="/" className="muted small">
        ← Sportchilar
      </Link>
      <div className="row between">
        <h1>{a.name}</h1>
        <button onClick={() => setEditing((x) => !x)}>{editing ? "Yopish" : "Tahrirlash"}</button>
      </div>

      {editing ? (
        <div className="card">
          <AthleteForm initial={draftOf(a)} onSubmit={save} onCancel={() => setEditing(false)} submitText="Saqlash" />
          <button
            className="danger small-btn"
            onClick={async () => {
              if (!confirm(`${a.name} va uning barcha natijalari o'chirilsinmi?`)) return;
              await del(`/api/athletes/${id}`);
              navigate("/");
            }}
          >
            Sportchini o'chirish
          </button>
        </div>
      ) : (
        <div className="stats">
          <div>
            <b>{s.age ?? "—"}</b>
            <span>yosh · {s.ageGroup?.id ?? "guruh yo'q"}</span>
          </div>
          <div>
            <b>{a.height_cm ?? "—"}</b>
            <span>sm</span>
          </div>
          <div>
            <b>{a.weight_kg ?? "—"}</b>
            <span>kg</span>
          </div>
          <div>
            <b>{s.bmi?.value ?? "—"}</b>
            <span>TVI · {s.bmi?.category ?? "—"}</span>
          </div>
          <div>
            <b>{s.targetGrade}</b>
            <span>maqsad baho</span>
          </div>
          <div>
            <b>{s.weeksLeft ?? "—"}</b>
            <span>hafta qoldi{a.target_date ? ` (${formatDate(a.target_date)})` : ""}</span>
          </div>
        </div>
      )}

      <div className="actions">
        <Link className="action" to={`/athletes/${id}/pullup`}>
          <span>🏋️</span>Turnik (AI kamera)
        </Link>
        <Link className="action" to={`/athletes/${id}/run`}>
          <span>🏃</span>Yugurish (GPS)
        </Link>
        <Link className="action primary" to={`/athletes/${id}/plan`}>
          <span>🤖</span>AI tayyorgarlik rejasi
        </Link>
      </div>

      <h2>Normativlar bo'yicha holat</h2>
      {!s.ageGroup && <p className="error">Bu yosh uchun normativ guruhi yo'q.</p>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mashq</th>
              <th>Oxirgi natija</th>
              <th>Baho</th>
              <th>Maqsad ({s.targetGrade})</th>
              <th>Farq</th>
              <th>5 / 4 / 3</th>
            </tr>
          </thead>
          <tbody>
            {s.items.map((i) => (
              <tr key={i.exercise.id} className={i.reached ? "row-ok" : ""}>
                <td>
                  {i.exercise.name}
                  {i.exercise.tracking !== "manual" && <span className="tag">{i.exercise.tracking === "pose" ? "AI" : "GPS"}</span>}
                </td>
                <td>{i.latest ? formatValue(i.exercise, i.latest.value) : <span className="muted">yo'q</span>}</td>
                <td>
                  <GradeBadge grade={i.grade} />
                </td>
                <td>{formatValue(i.exercise, i.required)}</td>
                <td className={i.reached ? "ok-text" : "warn-text"}>{formatGap(i.exercise, i.gap)}</td>
                <td className="muted small">{i.standard ? [5, 4, 3].map((g) => formatValue(i.exercise, i.standard!.grades[String(g) as "5"])).join(" / ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Natija kiritish</h2>
      <form className="card form inline" onSubmit={addResult}>
        <select required value={entry.exercise_id} onChange={(e) => setEntry({ ...entry, exercise_id: e.target.value })}>
          <option value="">Mashqni tanlang</option>
          {s.items.map((i) => (
            <option key={i.exercise.id} value={i.exercise.id}>
              {i.exercise.name}
            </option>
          ))}
        </select>
        <input
          required
          placeholder={entryEx?.unit === "soniya" ? "13:45 yoki 14.2" : entryEx?.unit ?? "natija"}
          value={entry.value}
          inputMode="decimal"
          onChange={(e) => setEntry({ ...entry, value: e.target.value })}
        />
        <button className="primary">Qo'shish</button>
        {entryError && <p className="error">{entryError}</p>}
      </form>

      <h2>Natijalar tarixi</h2>
      {!results.data?.length && <p className="muted">Natijalar yo'q</p>}
      <div className="table-wrap">
        <table>
          <tbody>
            {results.data?.map((r) => (
              <tr key={r.id}>
                <td className="muted small">{formatDateTime(r.recorded_at)}</td>
                <td>{exById[r.exercise_id]?.name ?? r.exercise_id}</td>
                <td>
                  <b>{formatValue(exById[r.exercise_id], r.value)}</b>
                  {r.source === "pose" && r.details?.invalid ? <span className="muted small"> (+{String(r.details.invalid)} hisoblanmagan)</span> : null}
                </td>
                <td className="small">
                  {SOURCE[r.source] ?? r.source}
                  {r.source === "gps" && (
                    <>
                      {" · "}
                      <Link to={`/athletes/${id}/results/${r.id}/track`}>xarita</Link>
                      {r.details?.distanceSource === "osrm" ? " ✓ OSRM" : ""}
                    </>
                  )}
                </td>
                <td>
                  <button
                    className="link-btn"
                    title="O'chirish"
                    onClick={async () => {
                      if (!confirm("Natija o'chirilsinmi?")) return;
                      await del(`/api/results/${r.id}`);
                      reloadAll();
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
