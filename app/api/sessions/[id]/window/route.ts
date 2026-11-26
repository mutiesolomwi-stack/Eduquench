import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe, mfaBlocked } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { isSessionStaff, loadSession } from "@/lib/access";
import { planChallenges } from "@/lib/attendance/planner";
import { notifyMany } from "@/lib/notify/send";

/** Open or close the attendance window. Opening freezes the class rules onto the session and plans checks. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe(); const s = await loadSession(id);
  if (me && mfaBlocked(me)) return NextResponse.json({ error: "mfa_required" }, { status: 403 });
  const body = z.object({ action: z.enum(["open", "close"]) }).safeParse(await req.json().catch(() => null));
  if (!me || !s || !body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!(await isSessionStaff(me, s))) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sb = admin();

  if (body.data.action === "open") {
    const { data: open } = await sb.from("attendance_windows").select("id").eq("session_id", id).maybeSingle();
    if (open) return NextResponse.json({ error: "already_opened" }, { status: 409 });
    const { data: cls } = await sb.from("classes").select("rules").eq("id", s.class_id).single();
    const rules = cls!.rules as { grace_minutes: number; strict: boolean };
    await sb.from("sessions").update({ frozen_rules: rules, status: "live" }).eq("id", id);
    await sb.from("attendance_windows").insert({ org_id: s.org_id, session_id: id, opened_by: me.id });
    const { data: enrs } = await sb.from("enrollments").select("id, student_id").eq("class_id", s.class_id).eq("status", "approved");
    const plan = planChallenges({ startMs: Date.now(), endMs: Date.parse(s.ends_at), graceMinutes: rules.grace_minutes, strict: rules.strict });
    // Each student gets their own random schedule, so a friend cannot be told when the check will arrive.
    const rows = (enrs ?? []).flatMap((e) =>
      planChallenges({ startMs: Date.now(), endMs: Date.parse(s.ends_at), graceMinutes: rules.grace_minutes, strict: rules.strict })
        .map((c) => ({ org_id: s.org_id, session_id: id, enrollment_id: e.id, type: c.type,
                       due_at: new Date(c.dueAtMs).toISOString(), expires_at: new Date(c.expiresAtMs).toISOString() })));
    if (rows.length) await sb.from("challenges").insert(rows);
    await sb.rpc("rpc_audit", { p_org: s.org_id, p_actor: me.id, p_action: "attendance.window_opened", p_entity: "session",
      p_entity_id: id, p_old: null, p_new: { checks_per_student: plan.length }, p_reason: null, p_source: "teacher" });
    await notifyMany((enrs ?? []).map((e) => e.student_id), { org: s.org_id, kind: "attendance.window_opened", title: "Attendance is open", body: `"${s.title}" has started. Join from Eduquench and keep notifications on for checks.`, channels: ["push"], dedupe: (u) => `win:${id}:${u}` });
    return NextResponse.json({ ok: true, checksPerStudent: plan.length });
  }

  await sb.from("attendance_windows").update({ closed_at: new Date().toISOString() }).eq("session_id", id).is("closed_at", null);
  await sb.from("sessions").update({ status: "ended" }).eq("id", id);
  const { data: enrs } = await sb.from("enrollments").select("id").eq("class_id", s.class_id).eq("status", "approved");
  for (const e of enrs ?? []) await sb.rpc("rpc_compute_attendance", { p_session: id, p_enrollment: e.id });
  await sb.rpc("rpc_audit", { p_org: s.org_id, p_actor: me.id, p_action: "attendance.window_closed", p_entity: "session",
    p_entity_id: id, p_old: null, p_new: { computed: enrs?.length ?? 0 }, p_reason: null, p_source: "teacher" });
  return NextResponse.json({ ok: true });
}
