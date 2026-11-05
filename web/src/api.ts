import { CapacitorHttp, type HttpResponse } from "@capacitor/core";
import { getServerUrl, isNative } from "./platform";

export type Gender = "male" | "female";

export interface Athlete {
  id: number;
  name: string;
  gender: Gender;
  birth_date: string;
  height_cm: number | null;
  weight_kg: number | null;
  target_date: string | null;
  target_grade: number;
  training_days: number;
  notes: string;
  created_at: string;
  age?: number | null;
  ageGroup?: string | null;
  passedAll?: boolean;
  missing?: number;
}

export interface Exercise {
  id: string;
  name: string;
  unit: string;
  better: "higher" | "lower";
  tracking: "pose" | "gps" | "manual";
  distance?: number;
}

export interface Standard {
  exercise: string;
  gender: Gender;
  ageGroup: string;
  grades: Record<"3" | "4" | "5", number>;
}

export interface Normatives {
  title: string;
  note?: string;
  grades: Record<string, string>;
  passGrade: number;
  exercises: Exercise[];
  ageGroups: { id: string; min: number; max: number }[];
  standards: Standard[];
}

export interface Result {
  id: number;
  athlete_id: number;
  exercise_id: string;
  value: number;
  source: "manual" | "pose" | "gps";
  details: Record<string, unknown> | null;
  recorded_at: string;
}

export interface AssessmentItem {
  exercise: Exercise;
  standard: Standard | null;
  latest: { value: number; recorded_at: string; source: string } | null;
  best: { value: number; recorded_at: string } | null;
  grade: number | null;
  targetGrade: number;
  required: number | null;
  gap: number | null;
  gapPercent: number | null;
  reached: boolean | null;
  history: { value: number; recorded_at: string }[];
}

export interface Assessment {
  age: number | null;
  ageGroup: { id: string } | null;
  bmi: { value: number; category: string } | null;
  targetGrade: number;
  targetGradeName: string;
  weeksLeft: number | null;
  passedAll: boolean;
  missing: string[];
  items: AssessmentItem[];
}

export interface PlanItem {
  exerciseId: string | null;
  name: string;
  sets: number | null;
  reps: string;
  rest: string;
  note: string;
}

export interface TrainingPlan {
  summary: string;
  priorities: { exerciseId: string | null; reason: string }[];
  weeks: { week: number; focus: string; sessions: { day: string; title: string; durationMin: number | null; items: PlanItem[] }[] }[];
  milestones: { week: number | null; exerciseId: string | null; target: string }[];
  testDay: string;
  nutrition: string[];
  recovery: string[];
  warnings: string[];
}

export interface PlanRecord {
  id: number;
  athlete_id: number;
  created_at: string;
  source: "ai" | "rules";
  model: string | null;
  error: string | null;
  plan: TrainingPlan;
}

export interface RunAnalysis {
  ok: boolean;
  error?: string;
  pointsIn: number;
  pointsUsed: number;
  startedAt: string;
  elapsedMs: number;
  gpsDistance: number;
  matchedDistance: number | null;
  matchConfidence: number | null;
  distance: number;
  distanceSource: "gps" | "osrm";
  scale: number;
  smoothDistance: number;
  targetDistance: number | null;
  completed: boolean | null;
  resultSeconds: number | null;
  avgPaceSecPerKm: number | null;
  splits: { distance: number; elapsedMs: number; splitMs: number; paceSecPerKm: number }[];
  matchedLines: [number, number][][];
  track: [number, number, number][];
  warnings: string[];
}

export interface Health {
  ok: boolean;
  ai: { baseUrl: string; model: string; configured: boolean };
  osrm: { url: string; ok: boolean; error?: string; nearest?: { lat: number; lon: number }; distanceFromQuery?: number };
}

export interface MapConfig {
  tileUrl: string;
  tileAttribution: string;
  center: { lat: number; lon: number };
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseBody(text: unknown): unknown {
  if (typeof text !== "string") return text;
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/**
 * Calls the server's API. In the Android app the request goes through the
 * native HTTP client to the server set on first start (no CORS, plain http on
 * the local network allowed); in the browser it is a same-origin fetch.
 */
export async function api<T>(method: string, url: string, body?: unknown, server = getServerUrl()): Promise<T> {
  if (isNative) {
    if (!server) throw new ApiError(0, "Server manzili kiritilmagan (Sozlamalar → Server)");
    let res: HttpResponse;
    try {
      res = await CapacitorHttp.request({
        url: server + url,
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        data: body,
        connectTimeout: 10_000,
        // The AI plan can take a few minutes.
        readTimeout: 240_000,
      });
    } catch (e) {
      throw new ApiError(0, `Serverga ulanib bo'lmadi (${server}): ${(e as Error).message}`);
    }
    const data = parseBody(res.data);
    if (res.status >= 400 || res.status === 0) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  const res = await fetch(server + url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = parseBody(await res.text());
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const get = <T,>(url: string) => api<T>("GET", url);
export const post = <T,>(url: string, body: unknown = {}) => api<T>("POST", url, body);
export const put = <T,>(url: string, body: unknown) => api<T>("PUT", url, body);
export const del = <T,>(url: string) => api<T>("DELETE", url);
