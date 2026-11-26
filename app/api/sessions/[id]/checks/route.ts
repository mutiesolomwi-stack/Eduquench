import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

/** The student's open checks (also reachable by polling when push or sockets are unavailable). */
export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  const sb = admin();
  const { data: enr } = await sb.from("enrollments").select("id").eq("student_id", me.id).limit(100);
  const ids = (enr ?? []).map((e) => e.id);
  if (!ids.length) return NextResponse.json({ checks: [] });
  const now = new Date().toISOString();
  const { data } = await sb.from("challenges").select("id, type, due_at, expires_at")
    .eq("session_id", id).in("enrollment_id", ids).is("answered_at", null)
    .lte("due_at", now).gt("expires_at", now).order("due_at");
  return NextResponse.json({ checks: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
