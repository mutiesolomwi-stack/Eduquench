import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { normalisePhone } from "@/lib/payments/daraja";
import { stkPush } from "@/lib/payments/daraja-client";
import { tooMany } from "@/lib/access";

const Body = z.object({ feePlanId: z.string().uuid(), phone: z.string().min(9).max(16), beneficiaryId: z.string().uuid().optional() });

/** Records a payment intent FIRST, then prompts the phone. The callback must match this intent. */
export async function POST(req: NextRequest) {
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => null));
  const phone = body.success ? normalisePhone(body.data.phone) : null;
  if (!body.success || !phone) return NextResponse.json({ error: "bad_phone_or_plan" }, { status: 400 });
  if (tooMany(`stk:${me.id}`, 5, 10 * 60_000)) return NextResponse.json({ error: "slow_down" }, { status: 429 });

  const sb = admin();
  const beneficiary = body.data.beneficiaryId ?? me.id;
  const { data: plan } = await sb.from("fee_plans").select("id, class_id, org_id").eq("id", body.data.feePlanId).eq("active", true).maybeSingle();
  if (!plan) return NextResponse.json({ error: "unknown_plan" }, { status: 404 });
  // The beneficiary must be an approved student of that class: identity is confirmed before any payment is accepted.
  const { data: enr } = await sb.from("enrollments").select("id").eq("class_id", plan.class_id).eq("student_id", beneficiary).eq("status", "approved").maybeSingle();
  if (!enr) return NextResponse.json({ error: "beneficiary_not_approved" }, { status: 403 });

  const { data: intent, error } = await sb.rpc("rpc_create_intent", { p_payer: me.id, p_beneficiary: beneficiary, p_fee_plan: plan.id, p_phone: phone });
  if (error || !intent) return NextResponse.json({ error: "intent_failed" }, { status: 500 });
  const i = intent as { id: string; amount: number };
  try {
    const r = await stkPush({ phone, amount: Number(i.amount), reference: i.id.slice(0, 8), description: "Class fee" });
    await sb.rpc("rpc_set_checkout", { p_intent: i.id, p_checkout: r.checkoutRequestId, p_merchant: r.merchantRequestId });
    return NextResponse.json({ ok: true, intentId: i.id });
  } catch {
    await sb.rpc("rpc_fail_intent", { p_intent: i.id });
    return NextResponse.json({ error: "stk_failed" }, { status: 502 });
  }
}
