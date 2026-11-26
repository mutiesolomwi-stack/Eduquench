import { NextResponse, type NextRequest } from "next/server";
import { admin } from "@/lib/supabase/admin";
import { authorisedJob, denied } from "@/lib/jobs";

/** Minute tick: dispatch due checks, expire missed ones, close windows past session end + grace. */
export async function GET(req: NextRequest) {
  if (!authorisedJob(req)) return denied();
  const sb = admin(), now = new Date().toISOString();

  // 1. Mark due checks as sent (students pick them up by polling, Realtime Broadcast or push).
  const { data: due } = await sb.from("challenges").update({ sent_at: now }).is("sent_at", null).lte("due_at", now).select("id, session_id, enrollment_id, org_id");
  for (const c of due ?? []) {
    const { data: e } = await sb.from("enrollments").select("student_id").eq("id", c.enrollment_id).single();
    if (e) await sb.rpc("rpc_record_event", { p_session: c.session_id, p_student: e.student_id, p_type: "challenge_sent", p_meta: { challenge: c.id } });
  }

  // 2. Expire unanswered checks. A missed check is retried ONCE if the student has been heard from since it was due.
  const { data: late } = await sb.from("challenges").select("id, session_id, enrollment_id, expires_at, retried").is("answered_at", null).is("passed", null).lt("expires_at", now);
  let missed = 0, retried = 0;
  for (const c of late ?? []) {
    const { data: e } = await sb.from("enrollments").select("student_id").eq("id", c.enrollment_id).single();
    if (!e) continue;
    const { data: seen } = await sb.from("attendance_events").select("id").eq("session_id", c.session_id).eq("student_id", e.student_id)
      .in("type", ["heartbeat", "code_submitted"]).gt("occurred_at", c.expires_at).limit(1);
    if (!c.retried && seen?.length) {
      await sb.from("challenges").update({ retried: true, expires_at: new Date(Date.now() + 90_000).toISOString() }).eq("id", c.id);
      retried++; continue;
    }
    await sb.from("challenges").update({ passed: false }).eq("id", c.id);
    await sb.rpc("rpc_record_event", { p_session: c.session_id, p_student: e.student_id, p_type: "challenge_missed", p_meta: { challenge: c.id } });
    missed++;
  }

  // 3. Close windows whose session ended more than the grace period ago, then compute statuses.
  const { data: wins } = await sb.from("attendance_windows").select("session_id, org_id").is("closed_at", null);
  let closed = 0;
  for (const w of wins ?? []) {
    const { data: s } = await sb.from("sessions").select("class_id, ends_at").eq("id", w.session_id).single();
    if (!s || Date.now() < Date.parse(s.ends_at) + 10 * 60_000) continue;
    await sb.from("attendance_windows").update({ closed_at: now }).eq("session_id", w.session_id).is("closed_at", null);
    await sb.from("sessions").update({ status: "ended" }).eq("id", w.session_id);
    const { data: enrs } = await sb.from("enrollments").select("id").eq("class_id", s.class_id).eq("status", "approved");
    for (const e of enrs ?? []) await sb.rpc("rpc_compute_attendance", { p_session: w.session_id, p_enrollment: e.id });
    await sb.rpc("rpc_audit", { p_org: w.org_id, p_actor: null, p_action: "attendance.window_auto_closed", p_entity: "session",
      p_entity_id: w.session_id, p_old: null, p_new: { computed: enrs?.length ?? 0 }, p_reason: null, p_source: "job" });
    closed++;
  }
  return NextResponse.json({ dispatched: due?.length ?? 0, missed, retried, closed });
}
