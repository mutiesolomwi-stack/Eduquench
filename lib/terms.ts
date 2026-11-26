/** Bump when the terms or guardian-consent wording changes; each consent row records the version accepted. */
export const TERMS_VERSION = "2026-11-v1";
export const safeNext = (n: unknown): string => (typeof n === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : "/dashboard");
