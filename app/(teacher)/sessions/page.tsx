import { requireMe, hasRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { SessionControls } from "./controls";

const eat = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function TeacherSessions() {
  const me = await requireMe();
  if (!hasRole(me, "teacher", "assistant", "school_admin", "system_admin")) redirect("/dashboard");
  const sb = await supabaseServer();
  const from = new Date(Date.now() - 6 * 3600_000).toISOString(), to = new Date(Date.now() + 7 * 86400_000).toISOString();
  const { data: sessions } = await sb.from("sessions").select("id, title, starts_at, ends_at, status").gte("ends_at", from).lte("starts_at", to).order("starts_at");
  return (
    <>
      <div className="row"><h1>Sessions</h1><a className="btn" href="/sessions/new">New session</a></div>
      {(sessions ?? []).length === 0 && <p className="card muted">No sessions in the next week.</p>}
      {(sessions ?? []).map((s) => (
        <section className="card" key={s.id}>
          <div className="row"><div><strong>{s.title}</strong><div className="muted">{eat.format(new Date(s.starts_at))} · {s.status}</div></div></div>
          <SessionControls sessionId={s.id} status={s.status} />
        </section>
      ))}
    </>
  );
}
