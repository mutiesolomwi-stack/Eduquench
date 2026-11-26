export type RoleName = "system_admin" | "school_admin" | "teacher" | "assistant" | "student" | "parent";

/** Admins must have completed a second factor in this session (Supabase assurance level aal2). */
export function adminNeedsMfa(roles: { role: RoleName }[], aal: string | undefined): boolean {
  const isAdmin = roles.some((r) => r.role === "system_admin" || r.role === "school_admin");
  return isAdmin && aal !== "aal2";
}
