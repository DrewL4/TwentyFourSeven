/** "95 min" from a duration in milliseconds, or null when the length is unknown. */
export function formatMinutes(durationMs: unknown): string | null {
  const ms = typeof durationMs === "string" ? Number(durationMs) : durationMs;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return `${Math.max(1, Math.round(ms / 60000))} min`;
}
