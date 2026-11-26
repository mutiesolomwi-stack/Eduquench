import { requireMe, hasRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Overview() {
  const me = await requireMe();
  if (!hasRole(me, "school_admin", "system_admin")) redirect("/dashboard");
  const sb = await supabaseServer();
  const [{ count: students }, { data: pays }, { data: recs }] = await Promise.all([
    sb.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "approved"),
    sb.from("payments").select("amount").limit(5000),
    sb.from("attendance_records").select("effective_status").limit(10000),
  ]);
  const collected = (pays ?? []).reduce((a, p) => a + Number(p.amount), 0);
  const by = (recs ?? []).reduce<Record<string, number>>((m, r) => ((m[r.effective_status] = (m[r.effective_status] ?? 0) + 1), m), {});
  return (
    <>
      <h1>School overview</h1>
      <div className="card row"><div><div className="muted">Enrolled students</div><strong>{students ?? 0}</strong></div>
        <div><div className="muted">Collected (KES)</div><strong>{collected.toLocaleString("en-KE")}</strong></div></div>
      <section className="card"><h2>Attendance records by status</h2>
        <table><tbody>{Object.entries(by).map(([k, v]) => <tr key={k}><td>{k.replace("_", " ")}</td><td>{v}</td></tr>)}</tbody></table></section>
    </>
  );
}
