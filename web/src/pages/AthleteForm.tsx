import { useState } from "react";
import type { Athlete, Gender } from "../api";

export interface AthleteDraft {
  name: string;
  gender: Gender;
  birth_date: string;
  height_cm: number | string | null;
  weight_kg: number | string | null;
  target_date: string | null;
  target_grade: number;
  training_days: number;
  notes: string;
}

export const emptyDraft = (): AthleteDraft => ({
  name: "",
  gender: "male",
  birth_date: "",
  height_cm: "",
  weight_kg: "",
  target_date: "",
  target_grade: 4,
  training_days: 4,
  notes: "",
});

export const draftOf = (a: Athlete): AthleteDraft => ({
  name: a.name,
  gender: a.gender,
  birth_date: a.birth_date,
  height_cm: a.height_cm ?? "",
  weight_kg: a.weight_kg ?? "",
  target_date: a.target_date ?? "",
  target_grade: a.target_grade,
  training_days: a.training_days,
  notes: a.notes ?? "",
});

export function AthleteForm({
  initial,
  onSubmit,
  onCancel,
  submitText,
}: {
  initial: AthleteDraft;
  onSubmit: (d: AthleteDraft) => Promise<void> | void;
  onCancel?: () => void;
  submitText: string;
}) {
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof AthleteDraft>(k: K, v: AthleteDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSubmit({
            ...d,
            height_cm: d.height_cm === "" ? null : Number(d.height_cm),
            weight_kg: d.weight_kg === "" ? null : Number(d.weight_kg),
            target_date: d.target_date || null,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Ism familiya
        <input required value={d.name} onChange={(e) => set("name", e.target.value)} />
      </label>
      <div className="grid2">
        <label>
          Jins
          <select value={d.gender} onChange={(e) => set("gender", e.target.value as Gender)}>
            <option value="male">Erkak</option>
            <option value="female">Ayol</option>
          </select>
        </label>
        <label>
          Tug'ilgan sana
          <input required type="date" value={d.birth_date} onChange={(e) => set("birth_date", e.target.value)} />
        </label>
        <label>
          Bo'yi (sm)
          <input type="number" min={80} max={250} step="0.5" value={d.height_cm ?? ""} onChange={(e) => set("height_cm", e.target.value)} />
        </label>
        <label>
          Vazni (kg)
          <input type="number" min={25} max={250} step="0.1" value={d.weight_kg ?? ""} onChange={(e) => set("weight_kg", e.target.value)} />
        </label>
        <label>
          Normativ topshirish sanasi
          <input type="date" value={d.target_date ?? ""} onChange={(e) => set("target_date", e.target.value)} />
        </label>
        <label>
          Maqsad baho
          <select value={d.target_grade} onChange={(e) => set("target_grade", Number(e.target.value))}>
            <option value={5}>5 — A'lo</option>
            <option value={4}>4 — Yaxshi</option>
            <option value={3}>3 — Qoniqarli</option>
          </select>
        </label>
        <label>
          Haftasiga mashg'ulot kunlari
          <select value={d.training_days} onChange={(e) => set("training_days", Number(e.target.value))}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} kun
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Izoh (jarohatlar, cheklovlar, sharoit)
        <textarea rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="row">
        <button className="primary" disabled={busy}>
          {submitText}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Bekor qilish
          </button>
        )}
      </div>
    </form>
  );
}
