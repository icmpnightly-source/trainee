import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type Athlete, get, type Normatives, post, type PlanRecord } from "../api";
import { formatDateTime } from "../format";
import { useApi } from "../hooks";

interface PlanListItem {
  id: number;
  created_at: string;
  source: "ai" | "rules";
  model: string | null;
  error: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function PlanPage() {
  const { id } = useParams();
  const athlete = useApi<Athlete>(`/api/athletes/${id}`);
  const norms = useApi<Normatives>("/api/normatives");
  const plans = useApi<PlanListItem[]>(`/api/athletes/${id}/plans`);
  const [plan, setPlan] = useState<PlanRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState(0);
  const [question, setQuestion] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);

  // Open the newest plan.
  useEffect(() => {
    if (plan || !plans.data?.length) return;
    get<PlanRecord>(`/api/plans/${plans.data[0].id}`).then(setPlan, () => {});
  }, [plans.data, plan]);

  const exName = (eid: string | null) => (eid && norms.data?.exercises.find((e) => e.id === eid)?.name) || eid || "";

  async function generate(mode: "ai" | "rules") {
    setError(null);
    setBusy(mode === "ai" ? "AI reja tuzmoqda… (bir necha o'n soniya ketishi mumkin)" : "Reja tuzilmoqda…");
    try {
      const p = await post<PlanRecord>(`/api/athletes/${id}/plan`, { mode });
      setPlan(p);
      setWeek(0);
      plans.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    const history = chat;
    setChat([...history, { role: "user", content: q }]);
    setQuestion("");
    try {
      const out = await post<{ answer: string }>(`/api/athletes/${id}/ask`, { question: q, history });
      setChat((c) => [...c, { role: "assistant", content: out.answer }]);
    } catch (err) {
      setChat((c) => [...c, { role: "assistant", content: `⚠ ${(err as Error).message}` }]);
    }
  }

  const p = plan?.plan;
  const w = p?.weeks[Math.min(week, (p?.weeks.length ?? 1) - 1)];

  return (
    <section>
      <Link to={`/athletes/${id}`} className="muted small">
        ← {athlete.data?.name ?? "Sportchi"}
      </Link>
      <h1>Tayyorgarlik rejasi</h1>
      <p className="muted small">
        Reja sportchining yoshi, bo'yi, vazni, yosh guruhining normativlari va oxirgi natijalaridagi farqdan kelib chiqib tuziladi. Natijalarni yangilagach, rejani qayta tuzing.
      </p>
      <div className="row">
        <button className="primary" disabled={Boolean(busy)} onClick={() => generate("ai")}>
          🤖 AI bilan reja tuzish
        </button>
        <button disabled={Boolean(busy)} onClick={() => generate("rules")}>
          Qoidalar asosida (AI siz)
        </button>
      </div>
      {busy && <p className="muted">{busy}</p>}
      {error && <p className="error">{error}</p>}

      {plan && p && (
        <>
          <div className="card">
            <div className="row between">
              <span className={`badge ${plan.source === "ai" ? "ok" : "warn"}`}>{plan.source === "ai" ? `AI · ${plan.model}` : "Qoidalar asosidagi reja"}</span>
              <span className="muted small">{formatDateTime(plan.created_at)}</span>
            </div>
            {plan.error && <p className="warn-text small">AI ishlamadi, shuning uchun qoidalar asosidagi reja berildi. Sabab: {plan.error}</p>}
            <p>{p.summary}</p>
            {p.priorities.length > 0 && (
              <ul className="small">
                {p.priorities.map((x, i) => (
                  <li key={i}>
                    <b>{exName(x.exerciseId)}</b> — {x.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {p.warnings.length > 0 && (
            <div className="card warn-card">
              {p.warnings.map((x, i) => (
                <p key={i} className="small">
                  ⚠ {x}
                </p>
              ))}
            </div>
          )}

          <div className="tabs">
            {p.weeks.map((x, i) => (
              <button key={i} className={i === week ? "active" : ""} onClick={() => setWeek(i)}>
                {x.week}-hafta
              </button>
            ))}
          </div>
          {w && (
            <>
              <p className="muted">{w.focus}</p>
              <div className="sessions">
                {w.sessions.map((s, i) => (
                  <div key={i} className="card">
                    <div className="row between">
                      <strong>
                        {s.day} — {s.title}
                      </strong>
                      {s.durationMin && <span className="muted small">{s.durationMin} daq</span>}
                    </div>
                    <table className="plan">
                      <tbody>
                        {s.items.map((it, j) => (
                          <tr key={j}>
                            <td>
                              {it.name}
                              {it.note && <div className="muted small">{it.note}</div>}
                            </td>
                            <td className="nowrap">{it.sets ? `${it.sets} × ${it.reps}` : it.reps}</td>
                            <td className="muted small nowrap">{it.rest}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </>
          )}

          {p.milestones.length > 0 && (
            <div className="card">
              <h2>Oraliq maqsadlar</h2>
              <table>
                <tbody>
                  {p.milestones.map((m, i) => (
                    <tr key={i}>
                      <td>{m.week ? `${m.week}-hafta` : ""}</td>
                      <td>{exName(m.exerciseId)}</td>
                      <td>
                        <b>{m.target}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid2">
            {p.nutrition.length > 0 && (
              <div className="card">
                <h2>Ovqatlanish</h2>
                <ul className="small">
                  {p.nutrition.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {(p.recovery.length > 0 || p.testDay) && (
              <div className="card">
                <h2>Tiklanish va sinov</h2>
                <ul className="small">
                  {p.recovery.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                  {p.testDay && <li>{p.testDay}</li>}
                </ul>
              </div>
            )}
          </div>
        </>
      )}

      <div className="card">
        <h2>Murabbiyga savol (AI)</h2>
        <div className="chat">
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ))}
        </div>
        <form className="form inline" onSubmit={ask}>
          <input placeholder="Masalan: tirsagim og'riyapti, rejani qanday o'zgartiray?" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <button className="primary">Yuborish</button>
        </form>
      </div>

      {plans.data && plans.data.length > 1 && (
        <details className="card">
          <summary>Avvalgi rejalar ({plans.data.length})</summary>
          <ul className="small">
            {plans.data.map((x) => (
              <li key={x.id}>
                <button className="link-btn" onClick={() => get<PlanRecord>(`/api/plans/${x.id}`).then((r) => (setPlan(r), setWeek(0)))}>
                  {formatDateTime(x.created_at)} — {x.source === "ai" ? `AI (${x.model})` : "qoidalar"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
