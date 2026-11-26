import { createHmac } from "node:crypto";

export const ROUND_SECONDS = 30;

export const roundOf = (unixSeconds: number): number => Math.floor(unixSeconds / ROUND_SECONDS);

/** code = last 6 digits of HMAC-SHA256(session_secret, round). Nothing is stored per round. */
export function codeForRound(secretHex: string, round: number): string {
  const mac = createHmac("sha256", Buffer.from(secretHex, "hex")).update(String(round)).digest();
  const n = mac.readUInt32BE(mac.length - 4) % 1_000_000;
  return n.toString().padStart(6, "0");
}

export function currentCode(secretHex: string, nowMs = Date.now()) {
  const round = roundOf(nowMs / 1000);
  const into = (nowMs / 1000) % ROUND_SECONDS;
  return { code: codeForRound(secretHex, round), round, secondsLeft: Math.ceil(ROUND_SECONDS - into) };
}

/** Accepts the current round and one either side. Returns the accepted round, or null. */
export function matchRound(secretHex: string, submitted: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(submitted)) return null;
  const now = roundOf(nowMs / 1000);
  for (const r of [now, now - 1, now + 1]) {
    if (codeForRound(secretHex, r) === submitted) return r;
  }
  return null;
}
