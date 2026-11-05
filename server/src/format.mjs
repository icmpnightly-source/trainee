import { formatDuration } from "../../shared/geo.js";

/** A result as people say it: "12 marta", "13:45", "14.2 soniya", "230 sm". */
export function formatValue(exercise, value) {
  if (value == null) return "—";
  if (exercise.unit === "soniya") return value >= 60 ? formatDuration(value) : `${value} soniya`;
  return `${value} ${exercise.unit ?? ""}`.trim();
}

export function formatGap(exercise, gap) {
  if (gap == null) return null;
  if (gap <= 0) return "bajarilgan";
  if (exercise.unit === "soniya") return `${formatValue(exercise, Math.round(gap * 10) / 10)} tezroq kerak`;
  return `yana ${Math.ceil(gap)} ${exercise.unit ?? ""}`.trim();
}

/** Seconds per km as "4:35 /km". */
export function formatPace(secPerKm) {
  return secPerKm == null ? "—" : `${formatDuration(Math.round(secPerKm))} /km`;
}
