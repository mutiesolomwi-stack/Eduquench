import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

const Body = z.object({
  enrollmentId: z.string().uuid(),
  status: z.enum(["verified_present", "late", "left_early", "partial", "excused", "absent"]),
  reason: z.string().trim().min(3).max(500),
});

/** Override with a mandatory reason. Authority is decided inside the database function, then audited. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe();
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (!body.success) return NextResponse.json({ error: "reason_required" }, { status: 400 });
  const { error } = await admin().rpc("rpc_apply_override", {
    p_actor: me.id, p_session: id, p_enrollment: body.data.enrollmentId, p_status: body.data.status, p_reason: body.data.reason });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
