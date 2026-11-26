import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { safeEqual, newLinkToken, newAccessCode, sha256, toBytea } from "@/lib/crypto";
import { parseStkCallback, verifyCallbackAgainstIntent, SAFARICOM_IPS } from "@/lib/payments/daraja";
import { stkQuery } from "@/lib/payments/daraja-client";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };
const HIGH_VALUE = 10_000; // KES: confirm with the STK query before granting access

/** Safaricom callbacks are unsigned. Defences: secret URL segment, intent match (id, amount, phone),
 *  unique receipt, STK query for high-value payments, and an allow-list of source addresses as an extra filter. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  const { secret } = await ctx.params;
  const expected = process.env.DARAJA_CALLBACK_SECRET ?? "";
  if (!expected || !safeEqual(secret, expected)) return new NextResponse(null, { status: 404 });

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
  const ipListed = SAFARICOM_IPS.includes(ip);
  const sb = admin();
  const cb = parseStkCallback(await req.json().catch(() => null));
  if (!cb) return NextResponse.json(ACK);

  const { data: intentRaw } = await sb.rpc("rpc_intent_by_checkout", { p_checkout: cb.checkoutRequestId });
  const intent = intentRaw as { id: string; org_id: string; payer_id: string; amount: string; phone: string; status: string } | null;
  const verdict = verifyCallbackAgainstIntent(cb, intent);

  if (!verdict.ok) {
    if (intent && verdict.reason === "failed_by_customer") await sb.rpc("rpc_fail_intent", { p_intent: intent.id });
    if (intent && verdict.reason !== "failed_by_customer") {
      await sb.rpc("rpc_audit", { p_org: intent.org_id, p_actor: null, p_action: "payment.callback_rejected", p_entity: "payment_intent",
        p_entity_id: intent.id, p_old: null, p_new: { reason: verdict.reason, receipt: cb.receipt ?? null, ip_listed: ipListed }, p_reason: null, p_source: "daraja" });
    }
    return NextResponse.json(ACK);
  }

  if (!intent || intent.status === "confirmed") return NextResponse.json(ACK);
  if (!ipListed || Number(intent.amount) >= HIGH_VALUE) {
    const q = await stkQuery(cb.checkoutRequestId).catch(() => null);
    if (!q || q.resultCode !== 0) {
      await sb.rpc("rpc_audit", { p_org: intent.org_id, p_actor: null, p_action: "payment.callback_unconfirmed", p_entity: "payment_intent",
        p_entity_id: intent.id, p_old: null, p_new: { ip_listed: ipListed, query: q?.resultCode ?? "error" }, p_reason: null, p_source: "daraja" });
      return NextResponse.json(ACK);
    }
  }

  const linkToken = newLinkToken(), code = newAccessCode(); // link redemption page is a follow-up; the join gateway already enforces the entitlement
  const { data: entitlement, error } = await sb.rpc("rpc_confirm_payment", {
    p_intent: intent.id, p_receipt: cb.receipt!, p_amount: cb.amount!, p_phone: cb.phone!,
    p_link_token_hash: toBytea(sha256(linkToken)), p_code_hash: toBytea(sha256(code)),
  });
  if (error || !entitlement) return NextResponse.json(ACK); // null = replayed receipt: nothing to do

  // Receipt for the payer; access pack (link and code) for the beneficiary. The plaintext exists only here and in the
  // beneficiary's own notification: the database keeps hashes. Delivery goes through the retrying outbox.
  const intentFull = intentRaw as unknown as { beneficiary_id: string };
  const same = intentFull.beneficiary_id === intent.payer_id;
  const pack = `Access code ${code}. Open ${process.env.APP_URL}/access/${linkToken} to see your QR code.`;
  await sb.rpc("rpc_notify", { p_user: intent.payer_id, p_org: intent.org_id, p_kind: "payment.receipt", p_title: "Payment received",
    p_body: `M-Pesa receipt ${cb.receipt}, KES ${cb.amount}. ${same ? pack : "The student has been sent their own access pack."}`, p_critical: true, p_channels: ["email", "push"], p_dedupe: `rcpt:${cb.receipt}` });
  if (!same) await sb.rpc("rpc_notify", { p_user: intentFull.beneficiary_id, p_org: intent.org_id, p_kind: "access.pack", p_title: "Your class access is ready",
    p_body: pack, p_critical: true, p_channels: ["email", "push"], p_dedupe: `pack:${cb.receipt}` });
  return NextResponse.json(ACK);
}
