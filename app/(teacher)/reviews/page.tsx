import { redirect } from "next/navigation";
import { requireAdminMfa, hasRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { ClaimRow, DeviceRow } from "./rows";

export default async function Reviews() {
  const me = await requireAdminMfa();
  if (!hasRole(me, "teacher", "school_admin", "system_admin")) redirect("/dashboard");
  const sb = admin();
  const [{ data: claims }, { data: devices }] = await Promise.all([sb.rpc("rpc_pending_claims", { p_actor: me.id }), sb.rpc("rpc_pending_devices", { p_actor: me.id })]);
  const dev = (devices ?? []) as { device_id: string; student_id: string; label: string | null; requested_at: string }[];
  const { data: names } = dev.length ? await sb.from("profiles").select("id, full_name").in("id", dev.map((d) => d.student_id)) : { data: [] };
  const nm = new Map((names ?? []).map((n) => [n.id, n.full_name]));
  const cl = (claims ?? []) as { claim_id: string; session_title: string; class_name: string; student_name: string; note: string; current_status: string | null }[];
  return (
    <>
      <h1>Reviews</h1>
      <section><h2>Connection-problem requests</h2>
        {cl.length === 0 && <p className="card muted">Nothing waiting.</p>}
        {cl.map((c) => <ClaimRow key={c.claim_id} id={c.claim_id} student={c.student_name} session={`${c.class_name}: ${c.session_title}`} note={c.note} current={c.current_status} />)}</section>
      <section><h2>New-device requests</h2>
        {dev.length === 0 && <p className="card muted">Nothing waiting.</p>}
        {dev.map((d) => <DeviceRow key={d.device_id} id={d.device_id} student={nm.get(d.student_id) ?? "Student"} label={d.label ?? "browser"} when={d.requested_at} />)}</section>
    </>
  );
}
