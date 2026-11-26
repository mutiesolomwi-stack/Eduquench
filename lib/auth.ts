import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase/server";
import { adminNeedsMfa } from "./mfa";

export type Role = "system_admin" | "school_admin" | "teacher" | "assistant" | "student" | "parent";
export interface Me { id: string; email?: string; aal?: string; roles: { org_id: string | null; role: Role }[] }

/** Verifies the user from the token's claims (not an unverified cookie) and loads roles from memberships. */
export async function getMe(): Promise<Me | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  const { data: m } = await sb.from("memberships").select("org_id, role").eq("user_id", sub).eq("status", "active");
  return { id: sub, email: data?.claims?.email as string | undefined, aal: data?.claims?.aal as string | undefined, roles: (m ?? []) as Me["roles"] };
}

export async function requireMe(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect("/sign-in");
  return me;
}

export const homeFor = (me: Me): string =>
  me.roles.some((r) => r.role === "system_admin") ? "/audit"
  : me.roles.some((r) => r.role === "school_admin") ? "/overview"
  : me.roles.some((r) => r.role === "teacher" || r.role === "assistant") ? "/sessions"
  : "/dashboard";

export function hasRole(me: Me, ...roles: Role[]) { return me.roles.some((r) => roles.includes(r.role)); }

/** Admin pages: signed in, then a second factor. Redirects to the MFA page when the factor is missing. */
export async function requireAdminMfa(): Promise<Me> {
  const me = await requireMe();
  if (adminNeedsMfa(me.roles, me.aal)) redirect("/security/mfa");
  return me;
}
/** For API handlers: true when an admin has NOT completed a second factor and must be refused. */
export const mfaBlocked = (me: Me) => adminNeedsMfa(me.roles, me.aal);
