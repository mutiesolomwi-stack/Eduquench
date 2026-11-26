import "server-only";
import { admin } from "./supabase/admin";
import type { Me } from "./auth";

export interface SessionRow { id: string; org_id: string; class_id: string; title: string; starts_at: string; ends_at: string; status: string }

export async function loadSession(id: string): Promise<SessionRow | null> {
  const { data } = await admin().from("sessions").select("id, org_id, class_id, title, starts_at, ends_at, status").eq("id", id).maybeSingle();
  return (data as SessionRow | null) ?? null;
}

/** Staff authority for a session: system admin, school admin of its school, or staff on its class. */
export async function isSessionStaff(me: Me, s: SessionRow, opts: { teacherOnly?: boolean } = {}): Promise<boolean> {
  if (me.roles.some((r) => r.role === "system_admin")) return true;
  if (me.roles.some((r) => r.role === "school_admin" && r.org_id === s.org_id)) return true;
  const { data } = await admin().from("class_staff").select("role").eq("class_id", s.class_id).eq("user_id", me.id);
  return (data ?? []).some((r) => (opts.teacherOnly ? r.role === "teacher" : true));
}

export async function windowIsOpen(sessionId: string): Promise<boolean> {
  const { data } = await admin().from("attendance_windows").select("id").eq("session_id", sessionId).is("closed_at", null).maybeSingle();
  return !!data;
}

/** Tiny per-instance failure counter. The Vercel Firewall is the main rate limiter; this adds a per-student guard. */
const hits = new Map<string, number[]>();
export function tooMany(key: string, max: number, windowMs: number): boolean {
  const now = Date.now(), arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
