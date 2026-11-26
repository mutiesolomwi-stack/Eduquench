import test from "node:test";
import assert from "node:assert/strict";
import { normalisePhone, parseStkCallback, verifyCallbackAgainstIntent, extractReceipt, darajaTimestamp, stkPassword } from "../lib/payments/daraja.ts";

const good = (over: Record<string, unknown> = {}) => ({ Body: { stkCallback: {
  MerchantRequestID: "m1", CheckoutRequestID: "ws_CO_1", ResultCode: 0, ResultDesc: "ok",
  CallbackMetadata: { Item: [
    { Name: "Amount", Value: 1500 }, { Name: "MpesaReceiptNumber", Value: "TKA1B2C3D4" },
    { Name: "PhoneNumber", Value: 254712345678 }, { Name: "TransactionDate", Value: 20261201130000 } ] }, ...over } } });

test("phone normalisation", () => {
  assert.equal(normalisePhone("0712 345 678"), "254712345678");
  assert.equal(normalisePhone("+254712345678"), "254712345678");
  assert.equal(normalisePhone("0112345678"), "254112345678");
  assert.equal(normalisePhone("712345678"), "254712345678");
  assert.equal(normalisePhone("0212345678"), null);
  assert.equal(normalisePhone("12345"), null);
});
test("parses a valid callback", () => {
  const cb = parseStkCallback(good())!;
  assert.equal(cb.amount, 1500); assert.equal(cb.receipt, "TKA1B2C3D4"); assert.equal(cb.phone, "254712345678");
});
test("rejects malformed bodies", () => {
  for (const b of [null, {}, { Body: {} }, { Body: { stkCallback: { ResultCode: 0 } } }, "x"]) assert.equal(parseStkCallback(b), null);
});
test("accepts only when amount and phone match the intent", () => {
  const cb = parseStkCallback(good())!;
  assert.deepEqual(verifyCallbackAgainstIntent(cb, { amount: "1500.00", phone: "254712345678" }), { ok: true });
  assert.deepEqual(verifyCallbackAgainstIntent(cb, { amount: 1000, phone: "254712345678" }), { ok: false, reason: "amount_mismatch" });
  assert.deepEqual(verifyCallbackAgainstIntent(cb, { amount: 1500, phone: "254700000000" }), { ok: false, reason: "phone_mismatch" });
  assert.deepEqual(verifyCallbackAgainstIntent(cb, null), { ok: false, reason: "unknown_intent" });
});
test("customer cancellation and missing metadata are not payments", () => {
  const cancelled = parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "x", ResultCode: 1032, ResultDesc: "cancelled" } } })!;
  assert.deepEqual(verifyCallbackAgainstIntent(cancelled, { amount: 1, phone: "254712345678" }), { ok: false, reason: "failed_by_customer" });
  const noMeta = parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "x", ResultCode: 0 } } })!;
  assert.deepEqual(verifyCallbackAgainstIntent(noMeta, { amount: 1, phone: "254712345678" }), { ok: false, reason: "missing_metadata" });
});
test("receipt must look like an M-Pesa code", () => {
  const cb = parseStkCallback(good())!; cb.receipt = "abc";
  assert.deepEqual(verifyCallbackAgainstIntent(cb, { amount: 1500, phone: "254712345678" }), { ok: false, reason: "bad_receipt" });
});
test("SMS parsing extracts only the receipt", () => {
  assert.equal(extractReceipt("TKA1B2C3D4 Confirmed. Ksh1,500.00 paid to Example School."), "TKA1B2C3D4");
  assert.equal(extractReceipt("hello there"), null);
  assert.equal(extractReceipt("ABCDEFGHIJ"), null); // no digit: not a plausible receipt
});
test("daraja timestamp is 14 digits in EAT", () => {
  assert.equal(darajaTimestamp(new Date(Date.UTC(2026, 11, 1, 10, 5, 9))), "20261201130509");
  assert.equal(stkPassword("174379", "pk", "20261201130509"), Buffer.from("174379pk20261201130509").toString("base64"));
});
