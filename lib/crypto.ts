import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Random 128-bit link token, URL-safe. Never derived from an M-Pesa receipt. */
export const newLinkToken = (): string => randomBytes(16).toString("base64url");

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
/** Short human-readable access code (8 chars, about 40 bits). */
export function newAccessCode(): string {
  const b = randomBytes(8);
  return Array.from(b, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join("");
}

export const sha256 = (v: string): Buffer => createHash("sha256").update(v).digest();

/** Postgres bytea literal for PostgREST: \x + hex. */
export const toBytea = (b: Buffer): string => "\\x" + b.toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
