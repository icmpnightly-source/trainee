import assert from "node:assert/strict";
import { test } from "node:test";
import { createCoach, extractJson, normalizePlan, planMessages } from "../src/ai.mjs";
import { buildCoachContext } from "../src/coach-context.mjs";
import { assess, loadNormatives } from "../src/normatives.mjs";
import { rulesPlan } from "../src/plan-rules.mjs";

const n = loadNormatives(null);
const athlete = { id: 1, name: "Test", gender: "male", birth_date: "2004-01-10", height_cm: 178, weight_kg: 72, target_grade: 4, target_date: "2026-12-31", training_days: 4 };
const results = [
  { exercise_id: "pullup", value: 6, recorded_at: "2026-11-01T10:00:00Z", source: "pose" },
  { exercise_id: "run_3km", value: 870, recorded_at: "2026-11-02T10:00:00Z", source: "gps" },
  { exercise_id: "run_1km", value: 230, recorded_at: "2026-11-02T10:00:00Z", source: "gps" },
];
const ctx = buildCoachContext(athlete, assess(n, athlete, results, new Date("2026-11-05T00:00:00Z")));

const samplePlan = {
  summary: "Reja",
  priorities: [{ exerciseId: "pullup", reason: "farq katta" }, { exerciseId: "unknown", reason: "x" }],
  weeks: [{ week: 1, focus: "f", sessions: [{ day: "Dushanba", title: "Kuch", durationMin: "50", items: [{ exerciseId: "pullup", name: "Tortilish", sets: "5", reps: 4, rest: "2 daqiqa" }] }] }],
  milestones: [{ week: 4, exerciseId: "pullup", target: "9 marta" }],
  nutrition: ["oqsil"],
  recovery: "not a list",
  warnings: [],
};

test("context carries targets, gaps and paces", () => {
  const p = ctx.items.find((i) => i.exerciseId === "pullup");
  assert.equal(p.targetValue, 12);
  assert.equal(p.gap, "yana 6 marta");
  const r = ctx.items.find((i) => i.exerciseId === "run_3km");
  assert.equal(r.target, "13:30");
  assert.equal(r.targetPace, "4:30 /km");
  assert.equal(ctx.athlete.weeksLeft, 8);
  assert.equal(ctx.detailWeeks, 4);
});

test("the prompt asks for json and carries the data", () => {
  const [sys, user] = planMessages(ctx);
  assert.equal(sys.role, "system");
  assert.match(user.content, /json/);
  assert.match(user.content, /"exerciseId": "pullup"/);
});

test("extractJson copes with fences and think blocks", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('<think>{"no":0}</think>Mana: {"a":2} tayyor'), { a: 2 });
  assert.throws(() => extractJson("hech narsa"), /JSON topilmadi/);
});

test("normalizePlan fixes types and drops unknown ids", () => {
  const plan = normalizePlan(samplePlan, ctx);
  assert.equal(plan.weeks[0].sessions[0].durationMin, 50);
  assert.equal(plan.weeks[0].sessions[0].items[0].sets, 5);
  assert.equal(plan.weeks[0].sessions[0].items[0].reps, "4");
  assert.equal(plan.priorities[1].exerciseId, null);
  assert.deepEqual(plan.recovery, []);
  assert.throws(() => normalizePlan({ weeks: [] }, ctx), /haftalar/);
});

test("coach sends model, json mode and key; parses the answer", async () => {
  let sent;
  const coach = createCoach({
    baseUrl: "https://api.example",
    apiKey: "sk-test",
    model: "test-model",
    fetchImpl: async (url, init) => {
      sent = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({ model: "test-model", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(samplePlan) } }] }));
    },
  });
  const out = await coach.plan(ctx);
  assert.equal(sent.url, "https://api.example/chat/completions");
  assert.equal(sent.init.headers.Authorization, "Bearer sk-test");
  assert.equal(sent.body.model, "test-model");
  assert.deepEqual(sent.body.response_format, { type: "json_object" });
  assert.equal(out.plan.weeks.length, 1);
});

test("coach retries without response_format when the server refuses it", async () => {
  const bodies = [];
  const coach = createCoach({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      if (body.response_format) return new Response(JSON.stringify({ error: { message: "response_format is not supported" } }), { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(samplePlan) + "\n```" } }] }));
    },
  });
  assert.equal(coach.configured, true, "a local server needs no key");
  const out = await coach.plan(ctx);
  assert.equal(bodies.length, 2);
  assert.equal(out.plan.summary, "Reja");
});

test("coach reports a missing key and a cut-off answer", async () => {
  const noKey = createCoach({ baseUrl: "https://api.deepseek.com", apiKey: "", model: "m" });
  await assert.rejects(noKey.plan(ctx), /AI_API_KEY/);
  const cut = createCoach({
    baseUrl: "https://api.example",
    apiKey: "k",
    model: "m",
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{" } }] })),
  });
  await assert.rejects(cut.plan(ctx), /uzildi/);
});

test("rules plan covers every exercise and the training days", () => {
  const plan = rulesPlan(ctx);
  assert.equal(plan.weeks.length, 4);
  assert.equal(plan.weeks[0].sessions.length, 4);
  const names = plan.weeks.flatMap((w) => w.sessions.flatMap((s) => s.items.map((i) => i.exerciseId))).filter(Boolean);
  for (const id of ["pullup", "run_3km", "run_1km", "pushup"]) assert.ok(names.includes(id), `${id} missing`);
  assert.ok(plan.milestones.some((m) => m.exerciseId === "pullup" && m.week === 8 && m.target === "12 marta"));
  assert.ok(plan.warnings.length >= 1);
  // The same shape the AI plan has.
  assert.deepEqual(normalizePlan(plan, ctx).weeks.length, 4);
});
