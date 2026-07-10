export type PresetKey = 'aoai' | 'cognitive';

export const PRESETS = {
  aoai: {
    label: 'AOAI Triage',
    products: ['Microsoft-Foundry', 'AI-Foundry', 'AOAI-V2', 'Agent-Service'] as string[],
    cycle: 'tue-thu' as const,
  },
  cognitive: {
    label: 'Cognitive Triage',
    products: [
      'Cog-speech-service',
      'Cog-computer-vision',
      'Cog-document-intelligence',
      'Cog-translator',
      'Cog-content-understanding',
      'Cog-language-service',
      'Cog-custom-vision-service',
    ] as string[],
    cycle: 'fri' as const,
  },
} as const;

// Compute midnight of `today` in Asia/Taipei, then step back `deltaDays` days.
// Returns ISO string that represents that local midnight instant.
function taipeiMidnightOffset(today: Date, deltaDays: number): string {
  // Get Taipei y/m/d for `today`.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(today);
  const y = Number(parts.find(p => p.type === 'year')!.value);
  const m = Number(parts.find(p => p.type === 'month')!.value);
  const d = Number(parts.find(p => p.type === 'day')!.value);
  // Asia/Taipei is UTC+8 year-round (no DST).
  // Midnight Taipei = 16:00 UTC of previous day.
  const utcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 3600 * 1000;
  const target = new Date(utcMs + deltaDays * 24 * 3600 * 1000);
  return target.toISOString();
}

// Get 0-6 (Sun-Sat) for `today` interpreted in Asia/Taipei.
function taipeiWeekday(today: Date): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
  }).format(today);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[s] ?? 0;
}

/**
 * Meeting-cycle since inference (all times Asia/Taipei midnight):
 * AOAI (tue-thu):
 *   Tue          -> last Thu (6 days ago)
 *   Wed          -> this-week Tue (1 day ago)
 *   Thu          -> this-week Tue (2 days ago)
 *   Fri/Sat/Sun/Mon -> last Thu
 * Cognitive (fri):
 *   Fri          -> last Fri (7 days ago)
 *   Sat/Sun/Mon/Tue/Wed/Thu -> most recent Fri
 */
export function inferSince(preset: PresetKey, today: Date = new Date()): string {
  const dow = taipeiWeekday(today);
  const cycle = PRESETS[preset].cycle;

  if (cycle === 'tue-thu') {
    if (dow === 2) return taipeiMidnightOffset(today, -6); // Tue -> last Thu
    if (dow === 4) return taipeiMidnightOffset(today, -2); // Thu -> this-week Tue
    if (dow === 3) return taipeiMidnightOffset(today, -1); // Wed -> this-week Tue
    // Fri(5) Sat(6) Sun(0) Mon(1) -> last Thu
    // days since last Thu: Fri=1, Sat=2, Sun=3, Mon=4
    const delta = dow === 5 ? -1 : dow === 6 ? -2 : dow === 0 ? -3 : -4;
    return taipeiMidnightOffset(today, delta);
  }

  // cycle === 'fri'
  if (dow === 5) return taipeiMidnightOffset(today, -7); // Fri -> last Fri
  // most recent Fri: Sat=1, Sun=2, Mon=3, Tue=4, Wed=5, Thu=6
  const delta = dow === 6 ? -1 : dow === 0 ? -2 : dow === 1 ? -3 : dow === 2 ? -4 : dow === 3 ? -5 : -6;
  return taipeiMidnightOffset(today, delta);
}

// For datetime-local input: convert ISO -> "YYYY-MM-DDTHH:mm" in local browser TZ.
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Convert "YYYY-MM-DDTHH:mm" (local TZ) -> ISO string.
export function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}
