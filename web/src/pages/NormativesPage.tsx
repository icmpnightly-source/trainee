import { useEffect, useState } from "react";
import { del, type Gender, type Normatives, put } from "../api";
import { formatValue, parseTime } from "../format";
import { useApi } from "../hooks";
import { isNative } from "../platform";

export function NormativesPage() {
  const { data, error, setData } = useApi<Normatives>("/api/normatives");
  const [draft, setDraft] = useState<Normatives | null>(null);
  const [gender, setGender] = useState<Gender>("male");
  const [group, setGroup] = useState("18-24");
  const [msg, setMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (data) setDraft(structuredClone(data));
  }, [data]);

  if (error) return <p className="error">{error}</p>;
  if (!draft) return <p className="muted">Yuklanmoqda…</p>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);

  function setValue(exercise: string, grade: "3" | "4" | "5", text: string) {
    const ex = draft!.exercises.find((e) => e.id === exercise)!;
    const value = ex.unit === "soniya" ? parseTime(text) : Number(text.replace(",", "."));
    setDraft((d) => {
      const n = structuredClone(d!);
      let s = n.standards.find((x) => x.exercise === exercise && x.gender === gender && x.ageGroup === group);
      if (!s) {
        s = { exercise, gender, ageGroup: group, grades: { 5: NaN, 4: NaN, 3: NaN } };
        n.standards.push(s);
      }
      s.grades[grade] = value ?? NaN;
      return n;
    });
  }

  function removeStandard(exercise: string) {
    setDraft((d) => ({ ...d!, standards: d!.standards.filter((x) => !(x.exercise === exercise && x.gender === gender && x.ageGroup === group)) }));
  }

  async function save() {
    setSaveError(null);
    try {
      const saved = await put<Normatives>("/api/normatives", draft);
      setData(saved);
      setMsg("Saqlandi");
    } catch (e) {
      setSaveError((e as Error).message);
    }
  }

  function download() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "normativlar.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function upload(file: File) {
    try {
      setDraft(JSON.parse(await file.text()));
      setMsg("Fayl yuklandi — tekshirib, Saqlash ni bosing");
    } catch {
      setSaveError("JSON fayl o'qilmadi");
    }
  }

  return (
    <section>
      <h1>Normativlar</h1>
      <div className="card small">
        <b>{draft.title}</b>
        {draft.note && <p className="warn-text">{draft.note}</p>}
        <p className="muted">
          Vaqt: <code>13:45</code> yoki <code>14.2</code> (soniya). Baholar tartibi: 5 eng qiyin. Bo'sh qoldirilgan mashq shu guruhda topshirilmaydi.
        </p>
      </div>

      <div className="card form inline">
        <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
          <option value="male">Erkaklar</option>
          <option value="female">Ayollar</option>
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {draft.ageGroups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.id} yosh
            </option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mashq</th>
              <th>5 — {draft.grades["5"]}</th>
              <th>4 — {draft.grades["4"]}</th>
              <th>3 — {draft.grades["3"]}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.exercises.map((ex) => {
              const s = draft.standards.find((x) => x.exercise === ex.id && x.gender === gender && x.ageGroup === group);
              return (
                <tr key={`${ex.id}-${gender}-${group}-${JSON.stringify(s?.grades ?? null)}`}>
                  <td>
                    {ex.name}
                    <div className="muted small">
                      {ex.unit}, {ex.better === "higher" ? "ko'proq yaxshi" : "kamroq yaxshi"}
                    </div>
                  </td>
                  {(["5", "4", "3"] as const).map((g) => (
                    <td key={g}>
                      <input
                        className="num"
                        defaultValue={s && Number.isFinite(s.grades[g]) ? (ex.unit === "soniya" ? formatValue(ex, s.grades[g]).replace(" s", "") : String(s.grades[g])) : ""}
                        onBlur={(e) => e.target.value.trim() && setValue(ex.id, g, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    {s && (
                      <button className="link-btn" title="Bu guruhdan olib tashlash" onClick={() => removeStandard(ex.id)}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row">
        <button className="primary" disabled={!dirty} onClick={save}>
          Saqlash
        </button>
        {!isNative && <button onClick={download}>JSON yuklab olish</button>}
        <label className="button">
          JSON yuklash
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
        <button
          className="danger"
          onClick={async () => {
            if (!confirm("Namunaviy jadvalga qaytarilsinmi? Tahrirlar o'chadi.")) return;
            setData(await del<Normatives>("/api/normatives"));
            setMsg("Namunaviy jadval tiklandi");
          }}
        >
          Namunaga qaytarish
        </button>
      </div>
      {msg && <p className="ok-text">{msg}</p>}
      {saveError && <p className="error">{saveError}</p>}
    </section>
  );
}
