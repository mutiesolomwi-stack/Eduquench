import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdminMfa, hasRole } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";

const Form = z.object({ orgId: z.string().uuid(), name: z.string().trim().min(2).max(120),
  type: z.enum(["one_off", "recurring", "multi_week", "bootcamp"]), provider: z.enum(["google_meet", "teams", "zoom", "pasted_link"]),
  meetingUrl: z.string().trim().url().startsWith("https://").optional().or(z.literal("")) });

async function createClass(fd: FormData) {
  "use server";
  const me = await requireAdminMfa();
  const f = Form.safeParse(Object.fromEntries(fd));
  if (!f.success) redirect("/classes?error=check");
  const { data, error } = await admin().rpc("rpc_create_class", { p_actor: me.id, p_org: f.data.orgId, p_name: f.data.name, p_type: f.data.type, p_provider: f.data.provider, p_meeting_url: f.data.meetingUrl ?? "" });
  redirect(error ? "/classes?error=denied" : `/classes/${data}`);
}

export default async function Classes({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const me = await requireAdminMfa();
  if (!hasRole(me, "teacher", "school_admin", "system_admin")) redirect("/dashboard");
  const { error } = await searchParams;
  const sb = await supabaseServer();
  const [{ data: classes }, { data: orgs }] = await Promise.all([sb.from("classes").select("id, name, class_type").order("name"), sb.from("organizations").select("id, name").eq("status", "approved")]);
  const myOrgs = (orgs ?? []).filter((o) => me.roles.some((r) => r.org_id === o.id && (r.role === "teacher" || r.role === "school_admin")) || hasRole(me, "system_admin"));
  return (
    <>
      <h1>Classes</h1>
      {(classes ?? []).map((c) => <div className="card row" key={c.id}><div><strong>{c.name}</strong><div className="muted">{c.class_type.replace("_", " ")}</div></div><Link className="btn" href={`/classes/${c.id}`}>Manage</Link></div>)}
      <form action={createClass} className="card"><h2>New class</h2>
        {error && <p className="err" role="alert">{error === "denied" ? "You can't create classes at that school." : "Check the form and try again."}</p>}
        <label htmlFor="orgId">School</label><select id="orgId" name="orgId" required>{myOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
        <label htmlFor="name">Class name</label><input id="name" name="name" required />
        <label htmlFor="type">Type</label><select id="type" name="type"><option value="recurring">Recurring weekly class</option><option value="one_off">One-off session</option><option value="multi_week">Multi-week course</option><option value="bootcamp">Cohort bootcamp</option></select>
        <label htmlFor="provider">Meeting platform</label><select id="provider" name="provider"><option value="google_meet">Google Meet</option><option value="pasted_link">Other link</option><option value="teams">Microsoft Teams (Phase 2 data)</option></select>
        <label htmlFor="meetingUrl">Default meeting link (https)</label><input id="meetingUrl" name="meetingUrl" type="url" />
        <p><button className="btn big" type="submit">Create class</button></p></form>
    </>
  );
}
