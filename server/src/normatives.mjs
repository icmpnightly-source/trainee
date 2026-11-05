import fs from "node:fs";
import path from "node:path";
import { SERVER_DIR } from "./config.mjs";

const DEFAULT_FILE = path.join(SERVER_DIR, "data", "normatives.json");
const GRADES = [5, 4, 3];

/** The table edited in the app (DATA_DIR/normatives.json) if there is one, the sample otherwise. */
export function loadNormatives(dataDir) {
  const custom = dataDir && path.join(dataDir, "normatives.json");
  const file = custom && fs.existsSync(custom) ? custom : DEFAULT_FILE;
  return validateNormatives(JSON.parse(fs.readFileSync(file, "utf8")));
}

export function saveNormatives(dataDir, table) {
  const valid = validateNormatives(table);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "normatives.json"), JSON.stringify(valid, null, 2) + "\n");
  return valid;
}

export function resetNormatives(dataDir) {
  fs.rmSync(path.join(dataDir, "normatives.json"), { force: true });
  return loadNormatives(dataDir);
}

function fail(message) {
  const err = new Error(message);
  err.status = 400;
  throw err;
}

export function validateNormatives(n) {
  if (!n || typeof n !== "object") fail("Normativ jadvali obyekt bo'lishi kerak");
  if (!Array.isArray(n.exercises) || !n.exercises.length) fail("exercises bo'sh");
  if (!Array.isArray(n.ageGroups) || !n.ageGroups.length) fail("ageGroups bo'sh");
  if (!Array.isArray(n.standards)) fail("standards massiv bo'lishi kerak");
  const exIds = new Set();
  for (const ex of n.exercises) {
    if (!ex.id || !ex.name) fail("Har bir mashqda id va name bo'lishi kerak");
    if (!["higher", "lower"].includes(ex.better)) fail(`${ex.id}: better "higher" yoki "lower" bo'lishi kerak`);
    exIds.add(ex.id);
  }
  const groupIds = new Set();
  for (const g of n.ageGroups) {
    if (!g.id || !Number.isFinite(g.min) || !Number.isFinite(g.max) || g.min > g.max) fail(`Yosh guruhi noto'g'ri: ${g.id}`);
    groupIds.add(g.id);
  }
  for (const s of n.standards) {
    if (!exIds.has(s.exercise)) fail(`Noma'lum mashq: ${s.exercise}`);
    if (!groupIds.has(s.ageGroup)) fail(`Noma'lum yosh guruhi: ${s.ageGroup}`);
    if (!["male", "female"].includes(s.gender)) fail(`Jins noto'g'ri: ${s.gender}`);
    const ex = n.exercises.find((e) => e.id === s.exercise);
    const values = GRADES.map((g) => Number(s.grades?.[g]));
    if (values.some((v) => !Number.isFinite(v))) fail(`${s.exercise}/${s.gender}/${s.ageGroup}: 5, 4, 3 baholar uchun son kerak`);
    const ordered = ex.better === "higher" ? values[0] >= values[1] && values[1] >= values[2] : values[0] <= values[1] && values[1] <= values[2];
    if (!ordered) fail(`${s.exercise}/${s.gender}/${s.ageGroup}: baholar tartibi noto'g'ri (5 eng qiyini bo'lishi kerak)`);
  }
  return {
    grades: { 5: "A'lo", 4: "Yaxshi", 3: "Qoniqarli" },
    passGrade: 3,
    ...n,
  };
}

/** Full years on `onDate` for a YYYY-MM-DD birth date. */
export function ageOn(birthDate, onDate = new Date()) {
  const b = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return null;
  const d = new Date(onDate);
  let age = d.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday = d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function ageGroupFor(n, age) {
  if (age == null) return null;
  return n.ageGroups.find((g) => age >= g.min && age <= g.max) ?? null;
}

export function standardFor(n, exerciseId, gender, ageGroupId) {
  return n.standards.find((s) => s.exercise === exerciseId && s.gender === gender && s.ageGroup === ageGroupId) ?? null;
}

/** 5, 4 or 3 for the best grade reached; 0 when below the lowest. */
export function gradeFor(exercise, standard, value) {
  if (value == null || !standard) return null;
  for (const g of GRADES) {
    const need = Number(standard.grades[g]);
    if (exercise.better === "higher" ? value >= need : value <= need) return g;
  }
  return 0;
}

/** How far `value` is from `required`: positive means still to gain, 0 or less means reached. */
export function gapTo(exercise, value, required) {
  if (value == null || required == null) return null;
  return exercise.better === "higher" ? required - value : value - required;
}

export function bmiOf(heightCm, weightKg) {
  if (!heightCm || !weightKg) return null;
  const bmi = weightKg / (heightCm / 100) ** 2;
  let category = "me'yorda";
  if (bmi < 18.5) category = "vazn yetishmaydi";
  else if (bmi >= 30) category = "semizlik";
  else if (bmi >= 25) category = "ortiqcha vazn";
  return { value: Math.round(bmi * 10) / 10, category };
}

export function weeksUntil(targetDate, now = new Date()) {
  if (!targetDate) return null;
  const t = new Date(`${targetDate}T00:00:00Z`).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil((t - new Date(now).getTime()) / (7 * 24 * 3600 * 1000)));
}

/**
 * Where an athlete stands against their age group's table: for every
 * exercise, the latest and best results, the grade reached, and the gap to
 * the target grade.
 */
export function assess(n, athlete, results, now = new Date()) {
  const age = ageOn(athlete.birth_date, now);
  const group = ageGroupFor(n, age);
  const targetGrade = GRADES.includes(Number(athlete.target_grade)) ? Number(athlete.target_grade) : 4;
  const items = [];
  for (const ex of n.exercises) {
    const standard = group ? standardFor(n, ex.id, athlete.gender, group.id) : null;
    const mine = results.filter((r) => r.exercise_id === ex.id).sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
    if (!standard && !mine.length) continue;
    const latest = mine[0] ?? null;
    const best = mine.reduce((acc, r) => (acc == null || (ex.better === "higher" ? r.value > acc.value : r.value < acc.value) ? r : acc), null);
    const required = standard ? Number(standard.grades[targetGrade]) : null;
    const value = latest?.value ?? null;
    const gap = gapTo(ex, value, required);
    items.push({
      exercise: ex,
      standard,
      latest: latest && { value: latest.value, recorded_at: latest.recorded_at, source: latest.source },
      best: best && { value: best.value, recorded_at: best.recorded_at },
      grade: gradeFor(ex, standard, value),
      targetGrade,
      required,
      gap,
      gapPercent: gap != null && required ? Math.round((gap / required) * 1000) / 10 : null,
      reached: gap != null ? gap <= 0 : null,
      history: mine.slice(0, 10).map((r) => ({ value: r.value, recorded_at: r.recorded_at })).reverse(),
    });
  }
  const graded = items.filter((i) => i.standard);
  return {
    athleteId: athlete.id,
    age,
    ageGroup: group,
    gender: athlete.gender,
    bmi: bmiOf(athlete.height_cm, athlete.weight_kg),
    targetGrade,
    targetGradeName: n.grades?.[targetGrade] ?? String(targetGrade),
    weeksLeft: weeksUntil(athlete.target_date, now),
    passGrade: n.passGrade ?? 3,
    passedAll: graded.length > 0 && graded.every((i) => i.grade != null && i.grade >= (n.passGrade ?? 3)),
    missing: graded.filter((i) => !i.latest).map((i) => i.exercise.id),
    items,
  };
}
