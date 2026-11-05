import { formatGap, formatPace, formatValue } from "./format.mjs";

const GENDER = { male: "erkak", female: "ayol" };
export const DEFAULT_WEEKS = 8;
export const DETAIL_WEEKS = 4;

/** Everything the coach (AI or rules) needs, in one plain object. */
export function buildCoachContext(athlete, assessment) {
  const weeksLeft = assessment.weeksLeft ?? DEFAULT_WEEKS;
  const items = assessment.items
    .filter((i) => i.standard)
    .map((i) => {
      const ex = i.exercise;
      const item = {
        exerciseId: ex.id,
        name: ex.name,
        unit: ex.unit,
        better: ex.better === "higher" ? "ko'proq yaxshi" : "kamroq (tezroq) yaxshi",
        standard: Object.fromEntries([5, 4, 3].map((g) => [g, formatValue(ex, i.standard.grades[g])])),
        latest: i.latest ? formatValue(ex, i.latest.value) : null,
        latestValue: i.latest?.value ?? null,
        best: i.best ? formatValue(ex, i.best.value) : null,
        currentGrade: i.grade,
        target: formatValue(ex, i.required),
        targetValue: i.required,
        gap: formatGap(ex, i.gap),
        gapValue: i.gap,
        gapPercent: i.gapPercent,
        history: i.history.map((h) => formatValue(ex, h.value)),
      };
      if (ex.distance && i.required) {
        item.distanceMeters = ex.distance;
        item.targetPace = formatPace(i.required / (ex.distance / 1000));
        if (i.latest) item.currentPace = formatPace(i.latest.value / (ex.distance / 1000));
      }
      return item;
    });
  return {
    athlete: {
      name: athlete.name,
      gender: GENDER[athlete.gender] ?? athlete.gender,
      age: assessment.age,
      ageGroup: assessment.ageGroup?.id ?? null,
      heightCm: athlete.height_cm,
      weightKg: athlete.weight_kg,
      bmi: assessment.bmi,
      trainingDaysPerWeek: athlete.training_days ?? 4,
      targetGrade: `${assessment.targetGrade} (${assessment.targetGradeName})`,
      targetDate: athlete.target_date ?? null,
      weeksLeft,
      notes: athlete.notes || null,
    },
    detailWeeks: Math.min(Math.max(weeksLeft, 1), DETAIL_WEEKS),
    missingResults: assessment.missing,
    items,
  };
}
