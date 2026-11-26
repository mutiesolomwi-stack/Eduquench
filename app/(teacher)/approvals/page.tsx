import { redirect } from "next/navigation";
import { requireMe, hasRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { ApprovalRow } from "./approval-row";

export default async function Approvals() {
  const me = await requireMe();
  if (!hasRole(me, "teacher", "school_admin", "system_admin")) redirect("/dashboard");
  const { data } = await admin().rpc("rpc_pending_enrollments", { p_actor: me.id });
  const rows = (data ?? []) as { enrollment_id: string; class_name: string; student_name: string; admission_no: string | null }[];
  return (
    <>
      <h1>Join requests</h1>
      {rows.length === 0 && <p className="card muted">No requests waiting.</p>}
      {rows.map((r) => <ApprovalRow key={r.enrollment_id} id={r.enrollment_id} student={r.student_name} admission={r.admission_no} className={r.class_name} />)}
    </>
  );
}
