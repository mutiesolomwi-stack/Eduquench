import test from "node:test";
import assert from "node:assert/strict";
import { codeForRound, matchRound, currentCode, roundOf } from "../lib/attendance/rotating-code.ts";

const S = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
const T = 1_800_000_000_000;

test("code is 6 digits and deterministic", () => {
  assert.match(codeForRound(S, 100), /^\d{6}$/);
  assert.equal(codeForRound(S, 100), codeForRound(S, 100));
});
test("code changes between rounds and between secrets", () => {
  assert.notEqual(codeForRound(S, 100), codeForRound(S, 101));
  assert.notEqual(codeForRound(S, 100), codeForRound("ff" + S.slice(2), 100));
});
test("accepts current round and one either side, rejects two away", () => {
  const r = roundOf(T / 1000);
  assert.equal(matchRound(S, codeForRound(S, r), T), r);
  assert.equal(matchRound(S, codeForRound(S, r - 1), T), r - 1);
  assert.equal(matchRound(S, codeForRound(S, r + 1), T), r + 1);
  assert.equal(matchRound(S, codeForRound(S, r - 2), T), null);
  assert.equal(matchRound(S, codeForRound(S, r + 2), T), null);
});
test("rejects malformed submissions", () => {
  for (const bad of ["", "12345", "1234567", "abcdef", "12 456"]) assert.equal(matchRound(S, bad, T), null);
});
test("secondsLeft is within 1..30", () => {
  const { secondsLeft } = currentCode(S, T + 7_500);
  assert.ok(secondsLeft >= 1 && secondsLeft <= 30);
});
