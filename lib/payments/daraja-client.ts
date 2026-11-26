import "server-only";
import { need } from "../env";
import { darajaTimestamp, stkPassword } from "./daraja";

const base = () => (process.env.DARAJA_ENV === "live" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke");

async function token(): Promise<string> {
  const auth = Buffer.from(`${need("DARAJA_CONSUMER_KEY")}:${need("DARAJA_CONSUMER_SECRET")}`).toString("base64");
  const r = await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: `Basic ${auth}` }, cache: "no-store" });
  if (!r.ok) throw new Error(`Daraja auth failed (${r.status})`);
  return (await r.json()).access_token;
}

export async function stkPush(a: { phone: string; amount: number; reference: string; description: string }) {
  const ts = darajaTimestamp(), shortcode = need("DARAJA_SHORTCODE");
  const body = {
    BusinessShortCode: shortcode, Password: stkPassword(shortcode, need("DARAJA_PASSKEY"), ts), Timestamp: ts,
    TransactionType: "CustomerPayBillOnline", Amount: Math.round(a.amount), PartyA: a.phone, PartyB: shortcode,
    PhoneNumber: a.phone, CallBackURL: `${need("APP_URL")}/api/daraja/${need("DARAJA_CALLBACK_SECRET")}/stk`,
    AccountReference: a.reference.slice(0, 12), TransactionDesc: a.description.slice(0, 13),
  };
  const r = await fetch(`${base()}/mpesa/stkpush/v1/processrequest`, {
    method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const j = await r.json();
  if (!r.ok || j.ResponseCode !== "0") throw new Error(j.errorMessage ?? j.ResponseDescription ?? "STK push failed");
  return { checkoutRequestId: j.CheckoutRequestID as string, merchantRequestId: j.MerchantRequestID as string };
}

/** Asks Safaricom whether an STK request succeeded: used when no callback arrived or before trusting a large payment. */
export async function stkQuery(checkoutRequestId: string): Promise<{ resultCode: number; desc: string }> {
  const ts = darajaTimestamp(), shortcode = need("DARAJA_SHORTCODE");
  const r = await fetch(`${base()}/mpesa/stkpushquery/v1/query`, {
    method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ BusinessShortCode: shortcode, Password: stkPassword(shortcode, need("DARAJA_PASSKEY"), ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId }),
    cache: "no-store",
  });
  const j = await r.json();
  return { resultCode: Number(j.ResultCode ?? -1), desc: String(j.ResultDesc ?? j.errorMessage ?? "") };
}
