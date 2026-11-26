import { redirect } from "next/navigation";
import { requireAdminMfa, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import Link from "next/link";

export default async function Reports() {
  const me = await requireAdminMfa();
  if (!hasRole(me, "teacher", "assistant", "school_admin", "system_admin")) redirect("/dashboard");
  const { data: classes } = await (await supabaseServer()).from("classes").select("id, name").order("name");
  return (<><h1>Reports</h1><p className="muted">Pick a class. Each report downloads as CSV or PDF and every export is recorded in the audit log.</p>
    {(classes ?? []).map((c) => <div className="card row" key={c.id}><strong>{c.name}</strong><Link className="btn" href={`/classes/${c.id}#reports`}>Open reports</Link></div>)}</>);
}
