import { requireMe } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { StatusBadge } from "@/components/ui/status-badge";
import { PayButton } from "./pay-button";
import { LiveCheck } from "./live-check";
import { PushSetup } from "./push-setup";
import { ClaimForm } from "./claim-form";

const REASONS: Record<string, string> = {
  not_enrolled: "You are not enrolled in this class yet.", no_entitlement: "Payment is needed before you can join.",
  outside_time_window: "Joining opens 15 minutes before the lesson.", session_cancelled: "This session was cancelled.",
  device_pending: "Your new device is waiting for teacher approval.", device_unknown: "Open Eduquench on your registered device.",
  slow_down: "Too many attempts. Wait a minute.", link_used_or_expired: "That join link was already used or has expired. Tap Join again.",
  invalid_link: "That join link is not valid.", school_not_approved: "This school is not active yet.",
};
const eat = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ join_error?: string }> }) {
  const me = await requireMe();
  const { join_error } = await searchParams;
  const sb = await supabaseServer(); // row-level security: only this student's rows come back
  const now = new Date(Date.now() - 60 * 60_000).toISOString();
  const [{ data: sessions }, { data: records }, { data: plans }, { data: classes }] = await Promise.all([
    sb.from("sessions").select("id, title, starts_at, ends_at, status, class_id").gte("ends_at", now).neq("status", "cancelled").order("starts_at").limit(10),
    sb.from("attendance_records").select("session_id, effective_status, student_id").eq("student_id", me.id).limit(500),
    sb.from("fee_plans").select("id, class_id, name, amount").eq("active", true),
    sb.from("classes").select("id, name"),
  ]);
  const name = new Map((classes ?? []).map((c) => [c.id, c.name]));
  const recIds = (records ?? []).map((r) => r.session_id);
  const { data: past } = recIds.length ? await sb.from("sessions").select("id, title, starts_at, ends_at").in("id", recIds) : { data: [] };
  const pastBy = new Map((past ?? []).map((p) => [p.id, p]));
  const total = records?.length ?? 0;
  const attended = (records ?? []).filter((r) => ["verified_present", "late", "left_early", "excused"].includes(r.effective_status)).length;
  const pct = total ? Math.round((attended / total) * 100) : null;

  return (
    <>
      <h1>My classes</h1>
      {join_error && <p className="card err" role="alert">{REASONS[join_error] ?? "You can't join this session right now."}</p>}
      <PushSetup />
      <LiveCheck sessionIds={(sessions ?? []).filter((s) => s.status === "live").map((s) => s.id)} />
      <section className="card"><div className="row"><h2>Attendance</h2><strong>{pct === null ? "No sessions yet" : `${pct}% overall`}</strong></div></section>
      <section aria-label="Upcoming sessions">
        <h2>Upcoming</h2>
        {(sessions ?? []).length === 0 && <p className="card muted">No upcoming sessions.</p>}
        {(sessions ?? []).map((s) => (
          <div className="card row" key={s.id}>
            <div><strong>{s.title}</strong><div className="muted">{name.get(s.class_id)} · {eat.format(new Date(s.starts_at))}</div></div>
            <form action={`/api/sessions/${s.id}/join`} method="post"><button className="btn big" type="submit">Join</button></form>
          </div>
        ))}
      </section>
      <section aria-label="Fees">
        <h2>Fees</h2>
        {(plans ?? []).map((p) => (
          <div className="card row" key={p.id}>
            <div><strong>{name.get(p.class_id)}</strong><div className="muted">{p.name} · KES {Number(p.amount).toLocaleString("en-KE")}</div></div>
            <PayButton feePlanId={p.id} />
          </div>
        ))}
      </section>
      <section aria-label="History"><h2>History</h2>
        {(records ?? []).length === 0 && <p className="card muted">No attendance records yet.</p>}
        {(records ?? []).slice(0, 20).map((r) => { const p = pastBy.get(r.session_id); const recent = p && Date.now() - Date.parse(p.ends_at) < 7 * 86400_000;
          return (<div className="card" key={r.session_id}><div className="row"><div><strong>{p?.title ?? "Session"}</strong><div className="muted">{p ? eat.format(new Date(p.starts_at)) : ""}</div></div><StatusBadge status={r.effective_status} /></div>
            {recent && ["absent", "partial", "late", "left_early"].includes(r.effective_status) && <ClaimForm sessionId={r.session_id} />}</div>); })}
      </section>
    </>
  );
}
