import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe, mfaBlocked } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const me = await getMe();
  const b = z.object({ claimId: z.string().uuid(), approve: z.boolean(), status: z.enum(["verified_present", "late", "left_early", "partial", "excused"]).optional(), reason: z.string().trim().min(3).max(500) }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "reason_required" }, { status: 400 });
  if (mfaBlocked(me)) return NextResponse.json({ error: "mfa_required" }, { status: 403 });
  const { error } = await admin().rpc("rpc_decide_claim", { p_actor: me.id, p_claim: b.data.claimId, p_approve: b.data.approve, p_status: b.data.status ?? null, p_reason: b.data.reason });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
