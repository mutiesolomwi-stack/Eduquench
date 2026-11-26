import "server-only";
import { admin } from "../supabase/admin";

export interface Note { org: string | null; kind: string; title: string; body: string; critical?: boolean; channels?: ("email" | "push")[]; dedupe?: (userId: string) => string | null }

/** Queue one notification per user (in-app row always; email and push through the outbox). Chunked so a class of
 *  several hundred does not open several hundred connections at once. */
export async function notifyMany(userIds: string[], n: Note): Promise<void> {
  const sb = admin();
  for (let i = 0; i < userIds.length; i += 25) {
    await Promise.all(userIds.slice(i, i + 25).map((u) => sb.rpc("rpc_notify", {
      p_user: u, p_org: n.org, p_kind: n.kind, p_title: n.title, p_body: n.body, p_critical: n.critical ?? false, p_channels: n.channels ?? [], p_dedupe: n.dedupe?.(u) ?? null })));
  }
}

export async function schoolAdminsOf(org: string): Promise<string[]> {
  const { data } = await admin().from("memberships").select("user_id").eq("org_id", org).eq("role", "school_admin").eq("status", "active");
  return (data ?? []).map((m) => m.user_id);
}
