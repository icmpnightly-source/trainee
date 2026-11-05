import assert from "node:assert/strict";
import { test } from "node:test";
import { ageGroupFor, ageOn, assess, bmiOf, gradeFor, loadNormatives, validateNormatives, weeksUntil } from "../src/normatives.mjs";

const n = loadNormatives(null);
const pullup = n.exercises.find((e) => e.id === "pullup");
const run3 = n.exercises.find((e) => e.id === "run_3km");

test("age counts full years, birthday included", () => {
  assert.equal(ageOn("2000-06-15", new Date("2026-06-14T12:00:00Z")), 25);
  assert.equal(ageOn("2000-06-15", new Date("2026-06-15T12:00:00Z")), 26);
  assert.equal(ageOn("not a date"), null);
});

test("age group lookup", () => {
  assert.equal(ageGroupFor(n, 18).id, "18-24");
  assert.equal(ageGroupFor(n, 24).id, "18-24");
  assert.equal(ageGroupFor(n, 25).id, "25-29");
  assert.equal(ageGroupFor(n, 10), null);
});

test("grades: more is better for pull-ups, less for runs", () => {
  const std = { grades: { 5: 15, 4: 12, 3: 9 } };
  assert.equal(gradeFor(pullup, std, 16), 5);
  assert.equal(gradeFor(pullup, std, 12), 4);
  assert.equal(gradeFor(pullup, std, 9), 3);
  assert.equal(gradeFor(pullup, std, 8), 0);
  const runStd = { grades: { 5: 750, 4: 810, 3: 870 } };
  assert.equal(gradeFor(run3, runStd, 740), 5);
  assert.equal(gradeFor(run3, runStd, 800), 4);
  assert.equal(gradeFor(run3, runStd, 900), 0);
});

test("assessment: gaps to the target grade", () => {
  const athlete = { id: 1, gender: "male", birth_date: "2004-01-10", height_cm: 178, weight_kg: 72, target_grade: 4, target_date: "2026-12-31" };
  const results = [
    { exercise_id: "pullup", value: 7, recorded_at: "2026-10-01T10:00:00Z", source: "pose" },
    { exercise_id: "pullup", value: 9, recorded_at: "2026-11-01T10:00:00Z", source: "pose" },
    { exercise_id: "run_3km", value: 840, recorded_at: "2026-11-02T10:00:00Z", source: "gps" },
  ];
  const a = assess(n, athlete, results, new Date("2026-11-05T00:00:00Z"));
  assert.equal(a.age, 22);
  assert.equal(a.ageGroup.id, "18-24");
  const p = a.items.find((i) => i.exercise.id === "pullup");
  assert.equal(p.latest.value, 9);
  assert.equal(p.best.value, 9);
  assert.equal(p.required, 12);
  assert.equal(p.gap, 3);
  assert.equal(p.grade, 3);
  const r = a.items.find((i) => i.exercise.id === "run_3km");
  assert.equal(r.gap, 840 - 810);
  assert.equal(r.reached, false);
  assert.ok(a.missing.includes("pushup"));
  assert.equal(a.passedAll, false);
  assert.equal(a.weeksLeft, 8);
  assert.equal(a.bmi.value, 22.7);
});

test("women have no pull-up standard in the sample table", () => {
  const a = assess(n, { id: 2, gender: "female", birth_date: "2000-01-01", target_grade: 3 }, [], new Date("2026-11-05"));
  assert.ok(!a.items.some((i) => i.exercise.id === "pullup"));
  assert.ok(a.items.some((i) => i.exercise.id === "pushup"));
});

test("validation rejects grades in the wrong order", () => {
  const bad = structuredClone(n);
  bad.standards[0].grades = { 5: 5, 4: 10, 3: 15 };
  assert.throws(() => validateNormatives(bad), /tartibi/);
});

test("bmi and weeks", () => {
  assert.equal(bmiOf(180, 81).value, 25);
  assert.equal(bmiOf(180, 81).category, "ortiqcha vazn");
  assert.equal(bmiOf(null, 80), null);
  assert.equal(weeksUntil("2026-11-19", new Date("2026-11-05T00:00:00Z")), 2);
  assert.equal(weeksUntil("2020-01-01", new Date("2026-11-05T00:00:00Z")), 0);
});
