import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { deviceState } from "@/lib/device";

/** Answer a random check. Verifies owner, device and latency; the result is written only by the server. */
export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string; cid: string }> }) {
  const { id, cid } = await ctx.params;
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  if ((await deviceState(me.id)) !== "active") return NextResponse.json({ error: "device" }, { status: 403 });
  const sb = admin();
  const { data: c } = await sb.from("challenges").select("id, enrollment_id, due_at, expires_at, answered_at").eq("id", cid).eq("session_id", id).maybeSingle();
  if (!c) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: enr } = await sb.from("enrollments").select("student_id").eq("id", c.enrollment_id).single();
  if (enr?.student_id !== me.id) return NextResponse.json({ error: "not_yours" }, { status: 403 });
  if (c.answered_at) return NextResponse.json({ error: "already_answered" }, { status: 409 });
  const now = Date.now();
  if (now < Date.parse(c.due_at) || now > Date.parse(c.expires_at)) return NextResponse.json({ error: "expired" }, { status: 410 });
  const { error } = await sb.from("challenges").update({ answered_at: new Date().toISOString(), passed: true }).eq("id", cid).is("answered_at", null);
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  await sb.rpc("rpc_record_event", { p_session: id, p_student: me.id, p_type: "challenge_answered", p_meta: { challenge: cid } });
  return NextResponse.json({ ok: true });
}
