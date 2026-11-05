import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { destination } from "../../shared/geo.js";
import { createApp } from "../src/app.mjs";
import { loadConfig } from "../src/config.mjs";
import { openMemoryDb } from "../src/db.mjs";

let server;
let base;
let coachCalls = 0;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trainee-test-"));

before(async () => {
  const config = { ...loadConfig(), dataDir };
  const fakeOsrm = {
    status: async () => ({ ok: true }),
    // Pretend the map trims GPS zigzag by 3%.
    match: async () => ({ distance: 0, confidence: 0, lines: [], unmatchedChunks: 1 }),
    route: async () => ({ distance: 1, duration: 1, coordinates: [] }),
    loop: async () => ({ distance: 3000, coordinates: [] }),
  };
  const failingCoach = {
    baseUrl: "https://api.example",
    defaultModel: "m",
    configured: true,
    plan: async () => {
      coachCalls += 1;
      throw new Error("tarmoq yo'q");
    },
    ask: async (_ctx, q) => ({ answer: `javob: ${q}`, model: "m" }),
    models: async () => ["m"],
  };
  server = http.createServer(createApp(config, openMemoryDb(), { osrm: fakeOsrm, coach: failingCoach }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const api = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test("athlete, results, assessment, plan", async () => {
  const bad = await api("POST", "/api/athletes", { name: "", gender: "male", birth_date: "2000-01-01" });
  assert.equal(bad.status, 400);

  const { body: a } = await api("POST", "/api/athletes", { name: "Ali Valiyev", gender: "male", birth_date: "2004-03-01", height_cm: 176, weight_kg: 70 });
  assert.ok(a.id);
  assert.equal(a.target_grade, 4);

  const r = await api("POST", `/api/athletes/${a.id}/results`, { exercise_id: "pullup", value: 8, source: "pose", details: { invalid: 2 } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.details, { invalid: 2 });
  assert.equal((await api("POST", `/api/athletes/${a.id}/results`, { exercise_id: "nope", value: 1 })).status, 400);

  const { body: s } = await api("GET", `/api/athletes/${a.id}/assessment`);
  assert.equal(s.items.find((i) => i.exercise.id === "pullup").latest.value, 8);

  // The AI is down: the plan still comes, from the rules, and says why.
  const { body: plan } = await api("POST", `/api/athletes/${a.id}/plan`, {});
  assert.equal(coachCalls, 1);
  assert.equal(plan.source, "rules");
  assert.match(plan.error, /tarmoq/);
  assert.ok(plan.plan.weeks.length > 0);
  const { body: list } = await api("GET", `/api/athletes/${a.id}/plans`);
  assert.equal(list[0].id, plan.id);

  const ask = await api("POST", `/api/athletes/${a.id}/ask`, { question: "Qanday?" });
  assert.equal(ask.body.answer, "javob: Qanday?");

  const upd = await api("PUT", `/api/athletes/${a.id}`, { weight_kg: 68, target_grade: 5 });
  assert.equal(upd.body.weight_kg, 68);
  assert.equal(upd.body.target_grade, 5);
});

test("a GPS run is checked and saved", async () => {
  const { body: a } = await api("POST", "/api/athletes", { name: "Runner", gender: "male", birth_date: "2001-05-05" });
  const start = { lat: 41.3, lon: 69.25 };
  const points = [];
  for (let s = 0; s <= 260; s++) points.push({ ...destination(start, 45, s * 4), t: 1_700_000_000_000 + s * 1000, acc: 6 });

  const short = await api("POST", `/api/athletes/${a.id}/runs`, { exercise_id: "run_1km", points: points.slice(0, 100) });
  assert.equal(short.status, 400);
  assert.match(short.body.error, /Masofa yetmadi/);

  const { status, body } = await api("POST", `/api/athletes/${a.id}/runs`, { exercise_id: "run_1km", points });
  assert.equal(status, 200);
  assert.equal(body.analysis.distanceSource, "gps");
  assert.ok(Math.abs(body.result.value - 250) < 0.2, `got ${body.result.value}`);
  const track = await api("GET", `/api/results/${body.result.id}/track`);
  assert.equal(track.body.raw.length, points.length);
});

test("normatives can be edited and reset", async () => {
  const { body: n } = await api("GET", "/api/normatives");
  const std = n.standards.find((s) => s.exercise === "pullup" && s.ageGroup === "18-24" && s.gender === "male");
  std.grades = { 5: 20, 4: 16, 3: 12 };
  const put = await api("PUT", "/api/normatives", n);
  assert.equal(put.status, 200);
  assert.ok(fs.existsSync(path.join(dataDir, "normatives.json")));
  std.grades = { 5: 1, 4: 16, 3: 12 };
  assert.equal((await api("PUT", "/api/normatives", n)).status, 400);
  const reset = await api("DELETE", "/api/normatives");
  assert.equal(reset.body.standards.find((s) => s.exercise === "pullup" && s.ageGroup === "18-24" && s.gender === "male").grades[5], 15);
});

test("unknown api path and method", async () => {
  assert.equal((await api("GET", "/api/nothing")).status, 404);
  assert.equal((await api("PATCH", "/api/athletes")).status, 405);
});
