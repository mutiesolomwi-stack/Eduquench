import { test, expect } from "@playwright/test";
import { ID, U, login, service } from "./helpers";

test("unpaid student is refused, a verified M-Pesa callback grants access once, a replay does nothing", async ({ page }) => {
  const sb = service();
  await page.route("https://meet.example.com/**", (r) => r.fulfill({ status: 200, body: "meeting room" })); // never leave the machine
  await login(page, U.student1);

  // 1. Unpaid: Join is refused with a plain-language reason.
  await page.getByRole("button", { name: "Join" }).first().click();
  await expect(page.getByRole("alert")).toContainText("Payment is needed");

  // 2. Payment: create the intent the way /api/payments/stk does, then deliver the callback as Safaricom would.
  const { data: intent } = await sb.rpc("rpc_create_intent", { p_payer: ID.student1, p_beneficiary: ID.student1, p_fee_plan: ID.plan, p_phone: "254712345678" });
  const checkout = `ws_CO_${Date.now()}`;
  await sb.rpc("rpc_set_checkout", { p_intent: (intent as { id: string }).id, p_checkout: checkout, p_merchant: "m-1" });
  const body = { Body: { stkCallback: { MerchantRequestID: "m-1", CheckoutRequestID: checkout, ResultCode: 0, ResultDesc: "ok", CallbackMetadata: { Item: [
    { Name: "Amount", Value: 500 }, { Name: "MpesaReceiptNumber", Value: "TKA1B2C3D4" }, { Name: "PhoneNumber", Value: 254712345678 }] } } } };
  const url = `/api/daraja/${process.env.DARAJA_CALLBACK_SECRET}/stk`;
  expect((await page.request.post(url, { data: body })).ok()).toBeTruthy();
  expect((await page.request.post(url, { data: body })).ok()).toBeTruthy(); // replay
  const { count } = await sb.from("entitlements").select("id", { count: "exact", head: true }).eq("student_id", ID.student1);
  expect(count).toBe(1);

  // 3. A wrong secret in the callback path is a 404 and changes nothing.
  expect((await page.request.post("/api/daraja/not-the-secret/stk", { data: body })).status()).toBe(404);

  // 4. Paid: Join now passes through the gateway to the meeting.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Join" }).first().click();
  await expect(page).toHaveURL(/meet\.example\.com/);
});

test("a callback with the wrong amount grants nothing", async ({ page }) => {
  const sb = service();
  const { data: intent } = await sb.rpc("rpc_create_intent", { p_payer: ID.student1, p_beneficiary: ID.student1, p_fee_plan: ID.plan, p_phone: "254712345678" });
  const checkout = `ws_CO_bad_${Date.now()}`;
  await sb.rpc("rpc_set_checkout", { p_intent: (intent as { id: string }).id, p_checkout: checkout, p_merchant: "m-2" });
  const before = (await sb.from("payments").select("id", { count: "exact", head: true })).count;
  await page.request.post(`/api/daraja/${process.env.DARAJA_CALLBACK_SECRET}/stk`, { data: { Body: { stkCallback: { MerchantRequestID: "m-2", CheckoutRequestID: checkout, ResultCode: 0, ResultDesc: "ok",
    CallbackMetadata: { Item: [{ Name: "Amount", Value: 1 }, { Name: "MpesaReceiptNumber", Value: "TKZ9Y8X7W6" }, { Name: "PhoneNumber", Value: 254712345678 }] } } } } });
  expect((await sb.from("payments").select("id", { count: "exact", head: true })).count).toBe(before);
});
