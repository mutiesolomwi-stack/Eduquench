import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe, mfaBlocked } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { deviceState } from "@/lib/device";
import { currentCode, matchRound } from "@/lib/attendance/rotating-code";
import { isSessionStaff, loadSession, tooMany, windowIsOpen } from "@/lib/access";

/** Teacher screen: the current rotating code, derived on the server. */
export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe(); const s = await loadSession(id);
  if (me && mfaBlocked(me)) return NextResponse.json({ error: "mfa_required" }, { status: 403 });
  if (!me || !s || !(await isSessionStaff(me, s))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: secret } = await admin().rpc("rpc_session_secret", { p_session: id });
  return NextResponse.json(currentCode(String(secret)), { headers: { "Cache-Control": "no-store" } });
}

/** Student submission: signed-in, device-bound, window open, once per round, rate-limited. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_code_format" }, { status: 400 });
  if (tooMany(`code:${me.id}:${id}`, 8, 60_000)) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  if ((await deviceState(me.id)) !== "active") return NextResponse.json({ error: "device" }, { status: 403 });
  if (!(await windowIsOpen(id))) return NextResponse.json({ error: "window_closed" }, { status: 409 });

  const sb = admin();
  const { data: secret } = await sb.rpc("rpc_session_secret", { p_session: id });
  const round = matchRound(String(secret), parsed.data.code);
  if (round === null) return NextResponse.json({ error: "wrong_code" }, { status: 422 });

  const { data: dupe } = await sb.from("attendance_events").select("id").eq("session_id", id).eq("student_id", me.id)
    .eq("type", "code_submitted").contains("meta", { round }).limit(1);
  if (dupe?.length) return NextResponse.json({ error: "already_used_this_round" }, { status: 409 });
  const enr = await sb.rpc("rpc_record_event", { p_session: id, p_student: me.id, p_type: "code_submitted", p_meta: { round } });
  if (!enr.data) return NextResponse.json({ error: "not_enrolled" }, { status: 403 });
  return NextResponse.json({ ok: true });
}
