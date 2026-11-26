import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { authorisedJob, denied } from "@/lib/jobs";

/** Daily audit digest: verify the hash chain end to end and store the latest hash OUTSIDE the audit table's reach. */
export async function GET(req: NextRequest) {
  if (!authorisedJob(req)) return denied();
  const sb = admin();
  const { data: broken } = await sb.rpc("rpc_verify_audit_chain");
  const { data: latest } = await sb.rpc("rpc_latest_audit_hash");
  const day = new Date().toISOString().slice(0, 10);
  await sb.storage.from("audit-digests").upload(`${day}.json`, JSON.stringify({ day, latest, firstBrokenId: broken }), { upsert: false, contentType: "application/json" });
  if (broken !== null) console.error("AUDIT CHAIN BROKEN at row", broken); // wire to your alerting channel
  return NextResponse.json({ ok: broken === null, firstBrokenId: broken });
}
