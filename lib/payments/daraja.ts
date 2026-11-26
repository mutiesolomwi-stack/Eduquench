/** Pure helpers for Daraja (M-Pesa). No network calls here; those live in daraja-client.ts. */

export const KE_PHONE = /^254[17][0-9]{8}$/;

/** Normalises 07xx, 01xx, +2547xx, 2547xx to 2547xxxxxxxx. Returns null if not a Kenyan mobile. */
export function normalisePhone(input: string): string | null {
  const d = input.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  let n: string;
  if (/^0[17][0-9]{8}$/.test(d)) n = "254" + d.slice(1);
  else if (/^254[17][0-9]{8}$/.test(d)) n = d;
  else if (/^[17][0-9]{8}$/.test(d)) n = "254" + d;
  else return null;
  return KE_PHONE.test(n) ? n : null;
}

export interface StkCallback {
  merchantRequestId: string; checkoutRequestId: string; resultCode: number; resultDesc: string;
  amount?: number; receipt?: string; phone?: string; transactionDate?: string;
}

/** Parses Safaricom's STK callback body defensively. Returns null if the shape is wrong. */
export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== "string" || typeof cb.ResultCode !== "number") return null;
  const out: StkCallback = {
    merchantRequestId: String(cb.MerchantRequestID ?? ""), checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode, resultDesc: String(cb.ResultDesc ?? ""),
  };
  const items = (cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] } | undefined)?.Item;
  if (Array.isArray(items)) {
    for (const it of items) {
      if (it.Name === "Amount") out.amount = Number(it.Value);
      else if (it.Name === "MpesaReceiptNumber") out.receipt = String(it.Value);
      else if (it.Name === "PhoneNumber") out.phone = String(it.Value);
      else if (it.Name === "TransactionDate") out.transactionDate = String(it.Value);
    }
  }
  return out;
}

export type CallbackVerdict =
  | { ok: true }
  | { ok: false; reason: "failed_by_customer" | "missing_metadata" | "amount_mismatch" | "phone_mismatch" | "bad_receipt" | "unknown_intent" };

/** Checks a parsed callback against the intent Eduquench created. Amount and phone must both match. */
export function verifyCallbackAgainstIntent(
  cb: StkCallback, intent: { amount: number | string; phone: string } | null,
): CallbackVerdict {
  if (!intent) return { ok: false, reason: "unknown_intent" };
  if (cb.resultCode !== 0) return { ok: false, reason: "failed_by_customer" };
  if (cb.amount === undefined || !cb.receipt || !cb.phone) return { ok: false, reason: "missing_metadata" };
  if (!/^[A-Z0-9]{10}$/.test(cb.receipt)) return { ok: false, reason: "bad_receipt" };
  if (Number(intent.amount) !== cb.amount) return { ok: false, reason: "amount_mismatch" };
  if (String(cb.phone) !== intent.phone) return { ok: false, reason: "phone_mismatch" };
  return { ok: true };
}

/** Pasted SMS: extract ONLY the receipt number. It is then looked up in payments; the text proves nothing. */
export function extractReceipt(sms: string): string | null {
  const m = sms.trim().toUpperCase().match(/\b([A-Z]{2}[A-Z0-9]{8})\s+CONFIRMED\b/) ?? sms.toUpperCase().match(/\b([A-Z0-9]{10})\b/);
  return m && /^[A-Z0-9]{10}$/.test(m[1]) && /[0-9]/.test(m[1]) ? m[1] : null;
}

/** Safaricom's published callback source addresses (extra filter only; confirm the current list at go-live). */
export const SAFARICOM_IPS = [
  "196.201.214.200", "196.201.214.206", "196.201.213.114", "196.201.214.207", "196.201.214.208",
  "196.201.213.44", "196.201.212.127", "196.201.212.138", "196.201.212.129", "196.201.212.136",
  "196.201.212.74", "196.201.212.69",
];

export const stkPassword = (shortcode: string, passkey: string, timestamp: string) =>
  Buffer.from(shortcode + passkey + timestamp).toString("base64");

/** Daraja timestamp YYYYMMDDHHmmss in East Africa Time. */
export function darajaTimestamp(d = new Date()): string {
  const eat = new Date(d.getTime() + 3 * 3600_000);
  return eat.toISOString().replace(/[-:T]/g, "").slice(0, 14);
}
