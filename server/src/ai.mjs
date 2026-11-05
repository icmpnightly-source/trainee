// The AI coach. Talks to any OpenAI-compatible chat API: DeepSeek's by
// default, or a model served on this machine (Ollama, llama.cpp, vLLM).

export class AiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const SYSTEM_PROMPT = `Sen jismoniy tayyorgarlik bo'yicha tajribali murabbiysan va sportchilarni normativ topshirishga tayyorlaysan.
Javoblaring faqat o'zbek tilida (lotin yozuvida), aniq va amaliy bo'lsin.
Sportchining hozirgi natijasi, yoshi, vazni, bo'yi va yosh guruhining normativ talablaridan kelib chiq.
Xavfsizlik birinchi o'rinda: jarohat xavfi bor tavsiyalar berma, og'riq yoki kasallik bo'lsa shifokorga murojaat qilishni eslat.`;

const PLAN_SCHEMA = `{
  "summary": "2-4 gapda umumiy baho va strategiya",
  "priorities": [{ "exerciseId": "mashq id", "reason": "nega birinchi navbatda" }],
  "weeks": [
    {
      "week": 1,
      "focus": "haftaning maqsadi",
      "sessions": [
        {
          "day": "Dushanba",
          "title": "mashg'ulot nomi",
          "durationMin": 50,
          "items": [
            { "exerciseId": "mashq id yoki null", "name": "mashq", "sets": 4, "reps": "6 yoki 400 m yoki 30 soniya", "rest": "2 daqiqa", "note": "texnika yoki sur'at" }
          ]
        }
      ]
    }
  ],
  "milestones": [{ "week": 2, "exerciseId": "mashq id", "target": "shu haftadagi oraliq maqsad" }],
  "testDay": "sinov kuni bo'yicha tavsiya",
  "nutrition": ["ovqatlanish bo'yicha tavsiya"],
  "recovery": ["tiklanish bo'yicha tavsiya"],
  "warnings": ["ehtiyot choralari"]
}`;

export function planMessages(ctx) {
  const rules = [
    `Haftada ${ctx.athlete.trainingDaysPerWeek} kun mashg'ulot bo'lsin.`,
    `"weeks" ichida birinchi ${ctx.detailWeeks} haftani kunma-kun batafsil yoz; normativ topshirishgacha ${ctx.athlete.weeksLeft} hafta qolgan, qolgan haftalar uchun "milestones" ber.`,
    "Farqi (gap) katta mashqlarga ko'proq e'tibor ber; maqsadga yetgan mashqlarni ushlab turish hajmida qoldir.",
    "Yuklama hafta sayin asta oshsin (haftasiga 10% dan ko'p emas); 4-haftada yengillashtirilgan hafta bo'lishi mumkin.",
    "Yugurish mashqlarida masofa va sur'atni (daqiqa:soniya /km) ko'rsat, maqsad sur'atidan (targetPace) kelib chiq.",
    "Tortilish uchun hozirgi maksimumdan kelib chiqib to'plam va takrorlar sonini aniq son bilan yoz.",
    "Natijasi kiritilmagan mashqlar (missingResults) bo'lsa, birinchi haftada sinov topshirishni rejaga qo'sh.",
    `"exerciseId" sifatida faqat ma'lumotlardagi id larni ishlat (${ctx.items.map((i) => i.exerciseId).join(", ")}).`,
  ];
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        "Quyidagi sportchini normativ topshirishga tayyorlash rejasini tuz.",
        "",
        "Qoidalar:",
        ...rules.map((r, i) => `${i + 1}. ${r}`),
        "",
        "Javobni faqat bitta json obyekt sifatida, quyidagi tuzilishda qaytar (boshqa matn qo'shma):",
        PLAN_SCHEMA,
        "",
        "Sportchi va normativ ma'lumotlari (JSON):",
        JSON.stringify(ctx, null, 2),
      ].join("\n"),
    },
  ];
}

/** Pulls the JSON object out of a model's answer (code fences, <think> blocks, text around it). */
export function extractJson(text) {
  if (typeof text !== "string") throw new AiError("Model javobi bo'sh");
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AiError("Model javobida JSON topilmadi");
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (err) {
    throw new AiError(`Model javobidagi JSON buzilgan: ${err.message}`);
  }
}

const str = (v, fallback = "") => (v == null ? fallback : typeof v === "string" ? v : String(v));
const strList = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x?.text ?? JSON.stringify(x))).filter(Boolean) : []);

/** Makes a model's plan safe to render: right types everywhere, no unknown exercise ids. */
export function normalizePlan(raw, ctx) {
  const ids = new Set(ctx.items.map((i) => i.exerciseId));
  const exId = (v) => (v != null && ids.has(String(v)) ? String(v) : null);
  const weeks = (Array.isArray(raw?.weeks) ? raw.weeks : [])
    .map((w, wi) => ({
      week: Number.isFinite(Number(w?.week)) ? Number(w.week) : wi + 1,
      focus: str(w?.focus),
      sessions: (Array.isArray(w?.sessions) ? w.sessions : []).map((s) => ({
        day: str(s?.day),
        title: str(s?.title, "Mashg'ulot"),
        durationMin: Number.isFinite(Number(s?.durationMin)) ? Number(s.durationMin) : null,
        items: (Array.isArray(s?.items) ? s.items : [])
          .filter((it) => it && (it.name || it.exercise))
          .map((it) => ({
            exerciseId: exId(it.exerciseId),
            name: str(it.name ?? it.exercise),
            sets: Number.isFinite(Number(it.sets)) ? Number(it.sets) : null,
            reps: str(it.reps),
            rest: str(it.rest),
            note: str(it.note),
          })),
      })),
    }))
    .filter((w) => w.sessions.length);
  if (!weeks.length) throw new AiError("Model rejasida haftalar yo'q");
  return {
    summary: str(raw.summary),
    priorities: (Array.isArray(raw.priorities) ? raw.priorities : [])
      .map((p) => ({ exerciseId: exId(p?.exerciseId), reason: str(p?.reason) }))
      .filter((p) => p.exerciseId || p.reason),
    weeks,
    milestones: (Array.isArray(raw.milestones) ? raw.milestones : [])
      .map((m) => ({ week: Number(m?.week) || null, exerciseId: exId(m?.exerciseId), target: str(m?.target) }))
      .filter((m) => m.target),
    testDay: str(raw.testDay),
    nutrition: strList(raw.nutrition),
    recovery: strList(raw.recovery),
    warnings: strList(raw.warnings),
  };
}

export function createCoach({ baseUrl, apiKey, model: defaultModel, timeoutMs = 180000, maxTokens = 6000, jsonMode = true, fetchImpl = fetch }) {
  const headers = () => ({
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  });

  async function request(path, init) {
    let res;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, { ...init, headers: headers(), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      const reason = err.name === "TimeoutError" ? `${Math.round(timeoutMs / 1000)} soniyada javob kelmadi` : err.cause?.code ?? err.message;
      throw new AiError(`AI serveriga ulanib bo'lmadi (${baseUrl}): ${reason}`);
    }
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const message = body?.error?.message ?? body?.message ?? text.slice(0, 300);
      const err = new AiError(`AI xatosi (HTTP ${res.status}): ${message}`, res.status === 401 ? 401 : 502);
      err.httpStatus = res.status;
      throw err;
    }
    return body;
  }

  async function chat(messages, { model, json, maxTokens: max = maxTokens, temperature = 0.4 }) {
    const payload = { model, messages, temperature, max_tokens: max, stream: false };
    if (json) payload.response_format = { type: "json_object" };
    try {
      return await request("/chat/completions", { method: "POST", body: JSON.stringify(payload) });
    } catch (err) {
      // Some servers and models do not take response_format; ask again without it.
      if (json && err.httpStatus === 400 && /response_format|json/i.test(err.message)) {
        delete payload.response_format;
        return request("/chat/completions", { method: "POST", body: JSON.stringify(payload) });
      }
      throw err;
    }
  }

  return {
    baseUrl,
    defaultModel,
    configured: Boolean(apiKey) || !/api\.deepseek\.com/.test(baseUrl),

    async models() {
      const body = await request("/models", { method: "GET" });
      return (body?.data ?? body?.models ?? []).map((m) => m.id ?? m.name).filter(Boolean);
    },

    async plan(ctx, { model = defaultModel } = {}) {
      if (!this.configured) throw new AiError("AI kaliti kiritilmagan (server/.env dagi AI_API_KEY)", 400);
      const started = Date.now();
      const body = await chat(planMessages(ctx), { model, json: jsonMode });
      const choice = body?.choices?.[0];
      if (choice?.finish_reason === "length") throw new AiError("Model javobi uzunlik chegarasida uzildi (AI_MAX_TOKENS ni oshiring)");
      if (!choice?.message?.content?.trim()) {
        // Thinking models can spend the whole budget on reasoning_content and answer nothing.
        throw new AiError("Model bo'sh javob qaytardi (fikrlash rejimi tokenlarni tugatgan bo'lishi mumkin: AI_MAX_TOKENS ni oshiring yoki boshqa model tanlang)");
      }
      const plan = normalizePlan(extractJson(choice?.message?.content), ctx);
      return { plan, model: body?.model ?? model, usage: body?.usage ?? null, ms: Date.now() - started };
    },

    async ask(ctx, question, { model = defaultModel, history = [] } = {}) {
      if (!this.configured) throw new AiError("AI kaliti kiritilmagan (server/.env dagi AI_API_KEY)", 400);
      const messages = [
        { role: "system", content: `${SYSTEM_PROMPT}\n\nSportchi ma'lumotlari (JSON):\n${JSON.stringify(ctx)}` },
        ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: str(m.content) })),
        { role: "user", content: question },
      ];
      const body = await chat(messages, { model, json: false, maxTokens: 1500, temperature: 0.5 });
      const content = body?.choices?.[0]?.message?.content ?? "";
      return { answer: content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim(), model: body?.model ?? model };
    },
  };
}
