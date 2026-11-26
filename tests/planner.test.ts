import test from "node:test";
import assert from "node:assert/strict";
import { planChallenges, maxGapMs } from "../lib/attendance/planner.ts";

const start = Date.UTC(2026, 11, 1, 13, 0), min = 60_000;

for (const lessonMin of [40, 60, 80, 120]) {
  test(`strict mode keeps every gap under the 10-minute grace for a ${lessonMin}-minute lesson`, () => {
    for (let i = 0; i < 200; i++) {
      const end = start + lessonMin * min;
      const cs = planChallenges({ startMs: start, endMs: end, graceMinutes: 10, strict: true });
      assert.ok(cs.length >= 2);
      assert.ok(maxGapMs(start, end, cs) < 10 * min, `gap ${maxGapMs(start, end, cs) / min} min`);
      for (const c of cs) { assert.ok(c.dueAtMs > start && c.dueAtMs < end); assert.ok(c.expiresAtMs > c.dueAtMs); }
    }
  });
}
test("challenge times are not predictable from a fixed seed-free run", () => {
  const end = start + 60 * min;
  const runs = new Set(Array.from({ length: 30 }, () => planChallenges({ startMs: start, endMs: end, graceMinutes: 10, strict: true }).map((c) => c.dueAtMs).join()));
  assert.ok(runs.size > 1);
});
test("empty or inverted window plans nothing", () => {
  assert.deepEqual(planChallenges({ startMs: start, endMs: start, graceMinutes: 10, strict: true }), []);
});
