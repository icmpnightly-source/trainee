// A training plan built from fixed coaching rules, used when the AI model
// cannot be reached. Same shape as the AI plan, so the screens show either.
import { formatDuration } from "../../shared/geo.js";

const WEEKDAYS = {
  3: ["Dushanba", "Chorshanba", "Juma"],
  4: ["Dushanba", "Seshanba", "Payshanba", "Shanba"],
  5: ["Dushanba", "Seshanba", "Chorshanba", "Juma", "Shanba"],
  6: ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba"],
};
const STRENGTH = new Set(["pullup", "pushup", "situp", "long_jump"]);
const RUNS = new Set(["run_100m", "run_1km", "run_3km"]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const item = (name, sets, reps, rest, note, exerciseId = null) => ({ exerciseId, name, sets, reps: String(reps), rest, note });

function strengthItems(it, week, deload) {
  const M = it.latestValue ?? 0;
  const T = it.targetValue ?? M;
  const k = deload ? 0.7 : 1;
  const grow = Math.floor((week - 1) * 1.0);
  switch (it.exerciseId) {
    case "pullup":
      if (M === 0)
        return [
          item("Manfiy tortilish (sakrab chiqib, 5 soniyada sekin tushish)", 4, 3 + Math.min(week - 1, 2), "2 daqiqa", "Iyak turnikdan yuqorida boshlang", "pullup"),
          item("Turnikda osilib turish", 3, `${20 + 10 * week} soniya`, "1 daqiqa", "Kuraklarni pastga tortib turing"),
          item("Avstraliyacha (past turnikda) tortilish", 3, 8 + week, "90 soniya", "Gavda to'g'ri chiziqda"),
        ];
      return [
        item("Turnikda tortilish", 5, Math.max(1, Math.round(clamp(M * 0.6 + grow, 1, T) * k)), "2 daqiqa", "Har takrorda to'liq osilib tushing, iyak turnikdan oshsin", "pullup"),
        item("Manfiy tortilish (4 soniyada tushish)", 3, M < 5 ? 3 : 4, "2 daqiqa", "Oxirgi kuch qolganda"),
        item("Kuraklarni tortish (scapular pull)", 3, 8, "1 daqiqa", "Qo'llar to'g'ri, faqat yelka harakati"),
      ];
    case "pushup":
      return [
        item("Qo'llarni bukib-yozish", 4, Math.max(3, Math.round(clamp(M * 0.6 + 2 * grow, 3, T) * k)), "90 soniya", "Ko'krak yerga 5 sm qolguncha tushing", "pushup"),
        item("Tor qo'l bilan bukib-yozish", 2, Math.max(3, Math.round(M * 0.35)), "90 soniya", "Tirsaklar tanaga yaqin"),
      ];
    case "situp":
      return [
        item("Qorin pressi", 4, Math.max(5, Math.round(clamp(M * 0.6 + 2 * grow, 5, T) * k)), "1 daqiqa", "Bir xil sur'atda, belni yerdan uzmang", "situp"),
        item("Planka", 3, `${30 + 10 * week} soniya`, "1 daqiqa", "Gavda to'g'ri chiziqda"),
      ];
    case "long_jump":
      return [
        item("Joyidan uzunlikka sakrash", 5, 3, "2 daqiqa", "Qo'llarni silkitib, ikki oyoqda qo'nish", "long_jump"),
        item("Chuqur o'tirib sakrash", 3, 8, "90 soniya", "Yumshoq qo'nish"),
        item("O'tirib-turish (squat)", 3, 12 + 2 * grow, "90 soniya", "Tizzalar oyoq uchidan chiqmasin"),
      ];
    default:
      return [];
  }
}

const paceOf = (it, meters) => (it.targetValue && it.distanceMeters ? (it.targetValue / it.distanceMeters) * meters : null);

function runItems(it, kind, week, deload) {
  const reps = (n) => Math.max(2, Math.round((n + Math.floor((week - 1) / 2)) * (deload ? 0.7 : 1)));
  switch (it.exerciseId) {
    case "run_100m":
      return kind === 0
        ? [item("Joyidan start (30 m)", reps(6), "30 m", "2 daqiqa", "Maksimal tezlik, to'liq dam oling", "run_100m"), item("60 m yugurish (90% kuch)", 4, "60 m", "3 daqiqa", "")]
        : [item("Yugurish texnikasi mashqlari (tizzani baland ko'tarish, sakrab yugurish)", 3, "30 m", "1 daqiqa", ""), item("100 m nazorat yugurish", 2, "100 m", "5 daqiqa", "Vaqtni yozib boring", "run_100m")];
    case "run_1km":
      if (kind === 0) return [item(`200 m interval (har biri ${formatDuration(Math.round(paceOf(it, 200)))} da)`, reps(6), "200 m", "90 soniya yurish", "Maqsad sur'atida", "run_1km")];
      if (kind === 1) return [item("Yengil yugurish", 1, `${20 + 2 * week} daqiqa`, "—", "Gaplasha oladigan sur'atda", "run_1km")];
      return [item(`500 m tempo (har biri ${formatDuration(Math.round(paceOf(it, 500)))} da)`, reps(2), "500 m", "3 daqiqa", "", "run_1km")];
    case "run_3km":
      if (kind === 0) return [item(`600 m interval (har biri ${formatDuration(Math.round(paceOf(it, 600)))} da)`, reps(5), "600 m", "2 daqiqa yurish", "Maqsad sur'atida", "run_3km")];
      if (kind === 1) return [item("Uzoq yengil yugurish", 1, `${30 + 3 * week} daqiqa`, "—", "Gaplasha oladigan sur'atda", "run_3km")];
      return [item(`Tempo yugurish (${it.targetPace} dan 15–20 soniya sekinroq)`, 1, `${12 + 2 * week} daqiqa`, "—", "", "run_3km")];
    default:
      return [];
  }
}

function milestonesFor(items, weeks) {
  const out = [];
  const checkpoints = weeks <= 2 ? [weeks] : [Math.round(weeks / 2), weeks];
  for (const it of items) {
    if (it.latestValue == null || it.targetValue == null || it.gapValue == null || it.gapValue <= 0) continue;
    for (const w of checkpoints) {
      const v = it.latestValue + (it.targetValue - it.latestValue) * (w / weeks);
      const text = it.unit === "soniya" ? (v >= 60 ? formatDuration(Math.round(v)) : `${Math.round(v * 10) / 10} soniya`) : `${it.better.startsWith("ko'proq") ? Math.ceil(v) : Math.floor(v)} ${it.unit}`;
      out.push({ week: w, exerciseId: it.exerciseId, target: text });
    }
  }
  return out.sort((a, b) => a.week - b.week);
}

export function rulesPlan(ctx) {
  const { athlete, items } = ctx;
  const weeks = athlete.weeksLeft || 8;
  const days = WEEKDAYS[clamp(athlete.trainingDaysPerWeek ?? 4, 3, 6)];
  // Every exercise gets trained; the ones furthest from the target get it more often.
  // Known gaps first (largest first), then exercises with no result yet, then the ones already reached.
  const rank = (i) => (i.gapValue == null ? 1 : i.gapValue > 0 ? 0 : 2);
  const byGap = [...items].sort((a, b) => rank(a) - rank(b) || (b.gapPercent ?? 0) - (a.gapPercent ?? 0));
  const strength = byGap.filter((i) => STRENGTH.has(i.exerciseId));
  const runs = byGap.filter((i) => RUNS.has(i.exerciseId));

  const types = days.map((_, i) => {
    if (!runs.length) return "S";
    if (!strength.length) return "R";
    return i % 2 === 0 ? "S" : "R";
  });

  const detail = Math.min(Math.max(weeks, 1), 4);
  const planWeeks = [];
  // Counted over the whole plan, so every run gets every kind of session in turn.
  let runIndex = 0;
  let strengthIndex = 0;
  for (let w = 1; w <= detail; w++) {
    const deload = w === 4 && weeks >= 6;
    const sessions = days.map((day, d) => {
      const warm = item("Badan qizdirish: yengil yugurish va bo'g'imlarni aylantirish", 1, "10 daqiqa", "—", "");
      const cool = item("Cho'zilish (stretching)", 1, "5–10 daqiqa", "—", "");
      if (types[d] === "S") {
        // The furthest-behind exercise every time; the others take turns.
        const pick = strength.length <= 2 ? strength : [strength[0], ...strength.slice(1).filter((_, i) => i % 2 === strengthIndex % 2)];
        strengthIndex += 1;
        return { day, title: "Kuch mashg'uloti", durationMin: 50, items: [warm, ...pick.flatMap((it) => strengthItems(it, w, deload)), cool] };
      }
      const it = runs[runIndex % runs.length];
      const kind = Math.floor(runIndex / runs.length) % 3;
      runIndex += 1;
      const titles = ["Interval yugurish", "Chidamlilik yugurishi", "Tempo yugurish"];
      return { day, title: titles[kind], durationMin: 45, items: [warm, ...runItems(it, kind, w, deload), cool] };
    });
    planWeeks.push({
      week: w,
      focus: deload ? "Yengillashtirilgan hafta: hajm 30% kam, tiklanish" : w === 1 ? "Moslashish va texnika" : "Hajm va intensivlikni oshirish",
      sessions,
    });
  }

  const worst = byGap.find((i) => i.gapValue != null && i.gapValue > 0);
  const summary = [
    `${athlete.age} yosh, ${athlete.ageGroup ?? "—"} yosh guruhi. Maqsad baho: ${athlete.targetGrade}. Qolgan vaqt: ${weeks} hafta.`,
    worst ? `Eng katta farq: ${worst.name} (${worst.gap}).` : items.some((i) => i.latestValue != null) ? "Kiritilgan natijalar maqsad bahoga yetgan — darajani ushlab turish rejasi." : "",
    ctx.missingResults.length ? "Ba'zi mashqlarda natija yo'q — birinchi haftada sinov topshiring." : "",
  ]
    .filter(Boolean)
    .join(" ");

  const warnings = [];
  if (athlete.bmi?.value >= 30) warnings.push("Tana vazni indeksi yuqori: yugurish hajmini sekin oshiring, mashg'ulotdan oldin shifokor bilan maslahatlashing.");
  if (athlete.age >= 40) warnings.push("40 yoshdan oshganlar uchun intensiv mashg'ulotdan oldin tibbiy ko'rik tavsiya etiladi.");
  if (ctx.missingResults.length)
    warnings.push(`Natija kiritilmagan mashqlar: ${ctx.missingResults.map((id) => items.find((i) => i.exerciseId === id)?.name ?? id).join(", ")}.`);
  warnings.push("Og'riq, bosh aylanishi yoki yurak sohasida noqulaylik bo'lsa, mashg'ulotni to'xtating.");

  return {
    summary,
    priorities: byGap.filter((i) => i.gapValue == null || i.gapValue > 0).slice(0, 3).map((i) => ({ exerciseId: i.exerciseId, reason: i.gap ?? "natija yo'q" })),
    weeks: planWeeks,
    milestones: milestonesFor(items, weeks),
    testDay: "Har 2 haftada bir marta barcha normativlarni sinov tariqasida topshiring va natijani ilovaga kiriting.",
    nutrition: [
      "Har kuni tana vaznining har kilogrammiga 1.4–1.8 g oqsil (go'sht, tuxum, tvorog, dukkaklilar).",
      "Mashg'ulotdan 2–3 soat oldin uglevodli ovqat (guruch, non, meva).",
      "Kuniga 2–3 litr suv; issiq kunlarda ko'proq.",
    ],
    recovery: ["Kuniga 7–9 soat uyqu.", "Og'ir mashg'ulotlar orasida kamida bir kun dam yoki yengil yurish.", "Mushaklar og'risa, hajmni kamaytiring, intensivlikni emas."],
    warnings,
  };
}
