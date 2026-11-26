import { randomInt } from "node:crypto";

export interface PlannedChallenge { dueAtMs: number; expiresAtMs: number; type: "tap" | "question" }

/**
 * Plans random challenge times with server-side randomness.
 * Strict mode keeps every gap (including the opening and closing gap) below the disconnect grace,
 * so a present student always produces a signal inside the grace period.
 */
export function planChallenges(opts: {
  startMs: number; endMs: number; graceMinutes: number; answerWindowSeconds?: number; strict: boolean;
  rand?: (maxExclusive: number) => number;
}): PlannedChallenge[] {
  const rand = opts.rand ?? ((n: number) => randomInt(n));
  const grace = opts.graceMinutes * 60_000;
  const win = (opts.answerWindowSeconds ?? 90) * 1000;
  const total = opts.endMs - opts.startMs;
  if (total <= 0) return [];
  // Strict: gap must stay under grace. Use a max gap of 80% of grace, with a floor of 2 checks.
  const maxGap = opts.strict ? Math.floor(grace * 0.8) : Math.floor(grace * 2);
  const count = Math.max(2, Math.ceil(total / maxGap) - 1);
  const slot = total / (count + 1);
  const out: PlannedChallenge[] = [];
  for (let i = 1; i <= count; i++) {
    // Jitter inside a window around the slot centre; the jitter is bounded so gaps stay below maxGap.
    const jitterSpan = Math.max(1, Math.floor(Math.min(slot * 0.3, (maxGap - slot) / 2 > 0 ? (maxGap - slot) / 2 : 0) * 2));
    const jitter = jitterSpan > 1 ? rand(jitterSpan) - Math.floor(jitterSpan / 2) : 0;
    const due = Math.round(opts.startMs + slot * i + jitter);
    out.push({ dueAtMs: due, expiresAtMs: due + win, type: i % 3 === 0 ? "question" : "tap" });
  }
  return out;
}

export function maxGapMs(startMs: number, endMs: number, cs: PlannedChallenge[]): number {
  const pts = [startMs, ...cs.map((c) => c.dueAtMs).sort((a, b) => a - b), endMs];
  let m = 0;
  for (let i = 1; i < pts.length; i++) m = Math.max(m, pts[i] - pts[i - 1]);
  return m;
}
