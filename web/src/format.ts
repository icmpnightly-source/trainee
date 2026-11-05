import { formatDuration } from "../../shared/geo.js";
import type { Exercise } from "./api";

export { formatDuration };

export function formatValue(ex: Pick<Exercise, "unit"> | undefined, value: number | null | undefined) {
  if (value == null) return "—";
  if (ex?.unit === "soniya") return value >= 60 ? formatDuration(value) : `${value} s`;
  return `${value} ${ex?.unit ?? ""}`.trim();
}

export function formatGap(ex: Exercise, gap: number | null) {
  if (gap == null) return "—";
  if (gap <= 0) return "bajarildi";
  if (ex.unit === "soniya") return `−${formatValue(ex, Math.round(gap * 10) / 10)}`;
  return `+${Math.ceil(gap)} ${ex.unit}`;
}

export const formatPace = (secPerKm: number | null | undefined) =>
  secPerKm == null || !Number.isFinite(secPerKm) ? "—" : `${formatDuration(Math.round(secPerKm))} /km`;

export const formatKm = (m: number | null | undefined) => (m == null ? "—" : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

export const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("uz-UZ", { year: "numeric", month: "2-digit", day: "2-digit" });
};

export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("uz-UZ")} ${d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}`;
};

export const GRADE_NAMES: Record<number, string> = { 5: "A'lo", 4: "Yaxshi", 3: "Qoniqarli", 0: "O'tmadi" };

/** Parses "13:45", "1:02:03", "14.2" into seconds. */
export function parseTime(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const parts = t.split(":").map(Number);
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
