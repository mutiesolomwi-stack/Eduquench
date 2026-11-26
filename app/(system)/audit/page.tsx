import { requireAdminMfa, hasRole } from "@/lib/auth";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AuditViewer() {
  const me = await requireAdminMfa();
  if (!hasRole(me, "system_admin", "school_admin")) redirect("/dashboard");
  const sb = await supabaseServer();
  const { data } = await sb.from("audit_log_view").select("id, action, entity, entity_id, reason, source, created_at").order("id", { ascending: false }).limit(100);
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Read-only. Rows cannot be edited or deleted by anyone, including the system admin.</p>
      <div className="card"><table><thead><tr><th>#</th><th>When</th><th>Action</th><th>Entity</th><th>Reason</th><th>Source</th></tr></thead><tbody>
        {(data ?? []).map((a) => <tr key={a.id}><td>{a.id}</td><td>{new Date(a.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</td><td>{a.action}</td><td>{a.entity} {String(a.entity_id).slice(0, 8)}</td><td>{a.reason ?? ""}</td><td>{a.source}</td></tr>)}
      </tbody></table></div>
    </>
  );
}
