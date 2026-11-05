import { createCoach } from "./ai.mjs";
import { buildCoachContext } from "./coach-context.mjs";
import { createRouter, HttpError, readJson, sendJson, serveStatic } from "./http.mjs";
import { assess, loadNormatives, resetNormatives, saveNormatives } from "./normatives.mjs";
import { createOsrm } from "./osrm.mjs";
import { rulesPlan } from "./plan-rules.mjs";
import { analyzeRun } from "./runs.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function athleteInput(body, partial = false) {
  const out = {};
  const need = (cond, msg) => {
    if (!cond) throw new HttpError(400, msg);
  };
  if (!partial || body.name !== undefined) {
    need(typeof body.name === "string" && body.name.trim(), "Ism kiritilmagan");
    out.name = body.name.trim();
  }
  if (!partial || body.gender !== undefined) {
    need(["male", "female"].includes(body.gender), "Jins: male yoki female");
    out.gender = body.gender;
  }
  if (!partial || body.birth_date !== undefined) {
    need(DATE_RE.test(body.birth_date ?? ""), "Tug'ilgan sana YYYY-MM-DD ko'rinishida bo'lsin");
    out.birth_date = body.birth_date;
  }
  for (const [key, lo, hi] of [
    ["height_cm", 80, 250],
    ["weight_kg", 25, 250],
  ]) {
    if (body[key] === undefined) continue;
    if (body[key] === null || body[key] === "") out[key] = null;
    else {
      const v = Number(body[key]);
      need(Number.isFinite(v) && v >= lo && v <= hi, `${key} ${lo}–${hi} oralig'ida bo'lsin`);
      out[key] = v;
    }
  }
  if (body.target_date !== undefined) {
    need(body.target_date === null || body.target_date === "" || DATE_RE.test(body.target_date), "Topshirish sanasi YYYY-MM-DD");
    out.target_date = body.target_date || null;
  }
  if (body.target_grade !== undefined) {
    need([3, 4, 5].includes(Number(body.target_grade)), "Maqsad baho 3, 4 yoki 5");
    out.target_grade = Number(body.target_grade);
  }
  if (body.training_days !== undefined) {
    need([3, 4, 5, 6].includes(Number(body.training_days)), "Haftalik mashg'ulot kunlari 3–6");
    out.training_days = Number(body.training_days);
  }
  if (body.notes !== undefined) out.notes = String(body.notes ?? "").slice(0, 2000);
  return out;
}

export function createApp(config, db, overrides = {}) {
  const osrm = overrides.osrm ?? createOsrm(config.osrm);
  const coach = overrides.coach ?? createCoach(config.ai);
  let normatives = loadNormatives(config.dataDir);
  const router = createRouter();
  const route = (m, p, h) => router.add(m, p, h);

  const athleteOr404 = (id) => {
    const a = db.getAthlete(Number(id));
    if (!a) throw new HttpError(404, "Sportchi topilmadi");
    return a;
  };
  const exerciseOr400 = (id) => {
    const ex = normatives.exercises.find((e) => e.id === id);
    if (!ex) throw new HttpError(400, `Noma'lum mashq: ${id}`);
    return ex;
  };
  const aiModel = () => db.getSetting("ai_model") || coach.defaultModel;
  const contextFor = (athlete) => buildCoachContext(athlete, assess(normatives, athlete, db.listResults(athlete.id)));

  route("GET", "/api/health", async () => {
    let osrmStatus;
    try {
      osrmStatus = await osrm.status(config.map.center);
    } catch (err) {
      osrmStatus = { ok: false, error: err.message };
    }
    return {
      ok: true,
      ai: { baseUrl: coach.baseUrl, model: aiModel(), configured: coach.configured },
      osrm: { url: config.osrm.baseUrl, ...osrmStatus },
    };
  });

  route("GET", "/api/config", () => ({ map: config.map }));

  // Normatives table
  route("GET", "/api/normatives", () => normatives);
  route("PUT", "/api/normatives", async ({ body }) => (normatives = saveNormatives(config.dataDir, body)));
  route("DELETE", "/api/normatives", () => (normatives = resetNormatives(config.dataDir)));

  // Athletes
  route("GET", "/api/athletes", () =>
    db.listAthletes().map((a) => {
      const s = assess(normatives, a, db.listResults(a.id));
      return { ...a, age: s.age, ageGroup: s.ageGroup?.id ?? null, passedAll: s.passedAll, missing: s.missing.length };
    }),
  );
  route("POST", "/api/athletes", ({ body }) => db.createAthlete(athleteInput(body)));
  route("GET", "/api/athletes/:id", ({ params }) => athleteOr404(params.id));
  route("PUT", "/api/athletes/:id", ({ params, body }) => {
    athleteOr404(params.id);
    return db.updateAthlete(Number(params.id), athleteInput(body, true));
  });
  route("DELETE", "/api/athletes/:id", ({ params }) => ({ deleted: db.deleteAthlete(Number(params.id)) }));
  route("GET", "/api/athletes/:id/assessment", ({ params }) => {
    const a = athleteOr404(params.id);
    return assess(normatives, a, db.listResults(a.id));
  });

  // Results
  route("GET", "/api/athletes/:id/results", ({ params }) => db.listResults(athleteOr404(params.id).id));
  route("POST", "/api/athletes/:id/results", ({ params, body }) => {
    const a = athleteOr404(params.id);
    const ex = exerciseOr400(body.exercise_id);
    const value = Number(body.value);
    if (!Number.isFinite(value) || value < 0) throw new HttpError(400, "Natija musbat son bo'lishi kerak");
    const source = ["manual", "pose", "gps"].includes(body.source) ? body.source : "manual";
    return db.addResult({ athlete_id: a.id, exercise_id: ex.id, value, source, details: body.details ?? null, recorded_at: body.recorded_at });
  });
  route("DELETE", "/api/results/:id", ({ params }) => ({ deleted: db.deleteResult(Number(params.id)) }));
  route("GET", "/api/results/:id/track", ({ params }) => {
    const t = db.getTrack(Number(params.id));
    if (!t) throw new HttpError(404, "Trek topilmadi");
    return t;
  });

  // Runs: analyse a GPS trace, or analyse and save it as a result
  const runPoints = (body) => {
    if (!Array.isArray(body.points)) throw new HttpError(400, "points massivi kerak");
    if (body.points.length > 50000) throw new HttpError(413, "Nuqtalar juda ko'p");
    return body.points.map((p) => ({ lat: Number(p.lat), lon: Number(p.lon), t: Number(p.t), acc: p.acc == null ? null : Number(p.acc) }));
  };
  route("POST", "/api/runs/analyze", async ({ body }) => {
    const ex = body.exercise_id ? exerciseOr400(body.exercise_id) : null;
    return analyzeRun({ points: runPoints(body), targetDistance: Number(body.target_distance) || ex?.distance || null, osrm });
  });
  route("POST", "/api/athletes/:id/runs", async ({ params, body }) => {
    const a = athleteOr404(params.id);
    const ex = exerciseOr400(body.exercise_id);
    if (!ex.distance) throw new HttpError(400, "Bu mashq yugurish emas");
    const analysis = await analyzeRun({ points: runPoints(body), targetDistance: ex.distance, osrm });
    if (!analysis.ok) throw new HttpError(400, analysis.error);
    if (!analysis.completed) throw new HttpError(400, `Masofa yetmadi: ${Math.round(analysis.distance)} / ${ex.distance} m`);
    const { track, matchedLines, ...summary } = analysis;
    const result = db.addResult({
      athlete_id: a.id,
      exercise_id: ex.id,
      value: analysis.resultSeconds,
      source: "gps",
      details: summary,
      recorded_at: analysis.startedAt,
    });
    db.saveTrack(result.id, track, matchedLines);
    return { result, analysis };
  });

  // Map: routes and loop courses on the local OSRM
  route("POST", "/api/osrm/route", async ({ body }) => osrm.route((body.points ?? []).map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }))));
  route("POST", "/api/osrm/loop", async ({ body }) => {
    const distance = Number(body.distance);
    if (!Number.isFinite(distance) || distance < 200 || distance > 50000) throw new HttpError(400, "Masofa 200–50000 m");
    return osrm.loop({ lat: Number(body.lat), lon: Number(body.lon) }, distance, Number(body.bearing) || 0);
  });

  // AI coach
  route("GET", "/api/ai/models", async () => ({ current: aiModel(), default: coach.defaultModel, models: await coach.models() }));
  route("PUT", "/api/ai/model", ({ body }) => {
    db.setSetting("ai_model", body.model ? String(body.model).trim() : null);
    return { current: aiModel() };
  });
  route("GET", "/api/athletes/:id/plans", ({ params }) => db.listPlans(athleteOr404(params.id).id));
  route("GET", "/api/plans/:id", ({ params }) => {
    const p = db.getPlan(Number(params.id));
    if (!p) throw new HttpError(404, "Reja topilmadi");
    return p;
  });
  route("POST", "/api/athletes/:id/plan", async ({ params, body }) => {
    const a = athleteOr404(params.id);
    const ctx = contextFor(a);
    if (!ctx.items.length) throw new HttpError(400, "Bu sportchining yosh guruhi uchun normativ topilmadi");
    const model = aiModel();
    if (body.mode !== "rules") {
      try {
        const out = await coach.plan(ctx, { model });
        return db.addPlan({ athlete_id: a.id, source: "ai", model: out.model, context: ctx, plan: out.plan });
      } catch (err) {
        return db.addPlan({ athlete_id: a.id, source: "rules", model: null, error: err.message, context: ctx, plan: rulesPlan(ctx) });
      }
    }
    return db.addPlan({ athlete_id: a.id, source: "rules", context: ctx, plan: rulesPlan(ctx) });
  });
  route("POST", "/api/athletes/:id/ask", async ({ params, body }) => {
    const a = athleteOr404(params.id);
    const question = String(body.question ?? "").trim();
    if (!question) throw new HttpError(400, "Savol bo'sh");
    return coach.ask(contextFor(a), question.slice(0, 4000), { model: aiModel(), history: Array.isArray(body.history) ? body.history : [] });
  });

  return async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
      return serveStatic(config.webDist, req, res, url.pathname);
    }
    const found = router.match(req.method, url.pathname);
    if (!found) return sendJson(res, 404, { error: "Topilmadi" });
    if (found.methodNotAllowed) return sendJson(res, 405, { error: "Method not allowed" });
    try {
      const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readJson(req) : {};
      const out = await found.handler({ params: found.params, body, query: url.searchParams, req });
      sendJson(res, 200, out ?? {});
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status === 500) console.error(err);
      sendJson(res, status, { error: err.message || "Server xatosi" });
    }
  };
}
