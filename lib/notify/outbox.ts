/** Outbox worker core. Providers and database calls are injected so the retry rules are testable without a network. */
export const MAX_ATTEMPTS = 6;

export interface OutboxRow { id: number; channel: "email" | "push" | "sms" | "whatsapp" | "in_app"; recipient: string; payload: Record<string, unknown>; attempts: number }
export type SendResult = { ok: true } | { ok: false; permanent: boolean; error: string; dropEndpoint?: boolean };

/** Back-off after the nth attempt (the claim already counted it): 30 s, 1 m, 2 m, 4 m ... capped at 1 hour. */
export const retryDelaySeconds = (attempts: number): number => Math.min(3600, 30 * 2 ** Math.max(0, attempts - 1));

export interface OutboxDeps {
  claim: (limit: number) => Promise<OutboxRow[]>;
  send: (row: OutboxRow) => Promise<SendResult>;
  report: (id: number, sent: boolean, permanent: boolean, retrySeconds: number, error: string | null) => Promise<void>;
  dropEndpoint: (endpoint: string) => Promise<void>;
}

export async function processOutbox(deps: OutboxDeps, limit = 50) {
  const rows = await deps.claim(limit);
  const out = { claimed: rows.length, sent: 0, retried: 0, failed: 0 };
  for (const row of rows) {
    let res: SendResult;
    try { res = await deps.send(row); } catch (e) { res = { ok: false, permanent: false, error: e instanceof Error ? e.message : "send threw" }; }
    if (res.ok) { await deps.report(row.id, true, false, 0, null); out.sent++; continue; }
    if (res.dropEndpoint && row.channel === "push") await deps.dropEndpoint(row.recipient);
    const permanent = res.permanent || row.attempts >= MAX_ATTEMPTS;
    await deps.report(row.id, false, permanent, permanent ? 0 : retryDelaySeconds(row.attempts), res.error);
    if (permanent) out.failed++; else out.retried++;
  }
  return out;
}
