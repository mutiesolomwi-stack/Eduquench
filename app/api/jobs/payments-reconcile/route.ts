import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { authorisedJob, denied } from "@/lib/jobs";
import { stkQuery } from "@/lib/payments/daraja-client";

/** Asks Safaricom about intents that never got a callback. A failed result closes the intent. A success with no callback
 *  is flagged in the audit log for the transaction-status check; access is never granted from a query alone, because the
 *  query does not return the receipt that makes a payment unique. */
export async function GET(req: NextRequest) {
  if (!authorisedJob(req)) return denied();
  const sb = admin();
  // payment_intents lives in the private schema, so it is read through a wrapper.
  const { data: pending } = await sb.rpc("rpc_pending_intents", { p_older_than_seconds: 120 });
  let failed = 0, flagged = 0;
  for (const i of (pending ?? []) as { id: string; org_id: string; checkout_request_id: string }[]) {
    const q = await stkQuery(i.checkout_request_id).catch(() => null);
    if (!q) continue;
    if (q.resultCode === 0) {
      await sb.rpc("rpc_audit", { p_org: i.org_id, p_actor: null, p_action: "payment.query_success_no_callback", p_entity: "payment_intent",
        p_entity_id: i.id, p_old: null, p_new: { desc: q.desc }, p_reason: null, p_source: "job" });
      flagged++;
    } else if ([1, 1032, 1037, 2001].includes(q.resultCode)) {
      await sb.rpc("rpc_fail_intent", { p_intent: i.id }); failed++;
    }
  }
  return NextResponse.json({ checked: pending?.length ?? 0, failed, flagged });
}
