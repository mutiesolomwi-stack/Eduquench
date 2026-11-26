import { requireMe } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function markRead() {
  "use server";
  const me = await requireMe(); const sb = await supabaseServer();
  await sb.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", me.id).is("read_at", null);
  revalidatePath("/notifications");
}

export default async function Notifications() {
  const me = await requireMe(); const sb = await supabaseServer();
  const { data } = await sb.from("notifications").select("id, title, body, critical, read_at, created_at").eq("user_id", me.id).order("created_at", { ascending: false }).limit(50);
  return (
    <>
      <div className="row"><h1>Notifications</h1><form action={markRead}><button className="btn ghost">Mark all read</button></form></div>
      {(data ?? []).length === 0 && <p className="card muted">Nothing yet.</p>}
      {(data ?? []).map((n) => <div className="card" key={n.id} style={{ borderLeft: n.read_at ? undefined : "4px solid var(--color-accent)" }}>
        <strong>{n.title}</strong>{n.critical && <span className="badge neutral" style={{ marginLeft: ".5rem" }}>Important</span>}<div>{n.body}</div>
        <div className="muted">{new Date(n.created_at).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}</div></div>)}
    </>
  );
}
