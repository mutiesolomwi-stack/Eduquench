import test from "node:test";
import assert from "node:assert/strict";
import { newLinkToken, newAccessCode, sha256, toBytea, safeEqual } from "../lib/crypto.ts";

test("link tokens are unique 128-bit values", () => {
  const s = new Set(Array.from({ length: 1000 }, newLinkToken));
  assert.equal(s.size, 1000);
  assert.equal(Buffer.from(newLinkToken(), "base64url").length, 16);
});
test("access code is 8 unambiguous characters", () => {
  for (let i = 0; i < 200; i++) assert.match(newAccessCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
});
test("hash and bytea literal", () => {
  assert.equal(toBytea(sha256("a")).length, 2 + 64);
  assert.ok(safeEqual("x", "x")); assert.ok(!safeEqual("x", "y")); assert.ok(!safeEqual("x", "xy"));
});
