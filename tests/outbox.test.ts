import test from "node:test";
import assert from "node:assert/strict";
import { processOutbox, retryDelaySeconds, MAX_ATTEMPTS, type OutboxRow, type SendResult } from "../lib/notify/outbox.ts";

const row = (id: number, attempts = 1, channel: OutboxRow["channel"] = "email"): OutboxRow => ({ id, channel, recipient: channel === "push" ? "https://push/x" : "a@b.c", payload: {}, attempts });
function harness(rows: OutboxRow[], results: Record<number, SendResult | "throw">) {
  const reports: unknown[][] = [], dropped: string[] = [];
  const deps = {
    claim: async () => rows,
    send: async (r: OutboxRow) => { const x = results[r.id]; if (x === "throw") throw new Error("boom"); return x ?? { ok: true as const }; },
    report: async (...a: unknown[]) => { reports.push(a); },
    dropEndpoint: async (e: string) => { dropped.push(e); },
  };
  return { deps, reports, dropped };
}

test("back-off doubles and caps at an hour", () => {
  assert.deepEqual([1, 2, 3, 4].map(retryDelaySeconds), [30, 60, 120, 240]);
  assert.equal(retryDelaySeconds(20), 3600);
});
test("successful sends are reported as sent", async () => {
  const h = harness([row(1)], {});
  assert.deepEqual(await processOutbox(h.deps), { claimed: 1, sent: 1, retried: 0, failed: 0 });
  assert.deepEqual(h.reports[0], [1, true, false, 0, null]);
});
test("a temporary failure is retried with back-off", async () => {
  const h = harness([row(2, 2)], { 2: { ok: false, permanent: false, error: "timeout" } });
  const r = await processOutbox(h.deps);
  assert.equal(r.retried, 1); assert.deepEqual(h.reports[0], [2, false, false, 60, "timeout"]);
});
test("a permanent failure is recorded and not retried", async () => {
  const h = harness([row(3)], { 3: { ok: false, permanent: true, error: "bad address" } });
  assert.equal((await processOutbox(h.deps)).failed, 1); assert.equal(h.reports[0][2], true);
});
test("too many attempts becomes permanent", async () => {
  const h = harness([row(4, MAX_ATTEMPTS)], { 4: { ok: false, permanent: false, error: "still down" } });
  assert.equal((await processOutbox(h.deps)).failed, 1);
});
test("a gone push endpoint is dropped", async () => {
  const h = harness([row(5, 1, "push")], { 5: { ok: false, permanent: true, dropEndpoint: true, error: "410" } });
  await processOutbox(h.deps); assert.deepEqual(h.dropped, ["https://push/x"]);
});
test("a throwing provider does not stop the batch", async () => {
  const h = harness([row(6), row(7)], { 6: "throw" });
  const r = await processOutbox(h.deps); assert.equal(r.retried, 1); assert.equal(r.sent, 1);
});
