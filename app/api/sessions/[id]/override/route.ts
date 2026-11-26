import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe, mfaBlocked } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { notifyMany, schoolAdminsOf } from "@/lib/notify/send";

const Body = z.object({
  enrollmentId: z.string().uuid(),
  status: z.enum(["verified_present", "late", "left_early", "partial", "excused", "absent"]),
  reason: z.string().trim().min(3).max(500),
});

/** Override with a mandatory reason. Authority is decided inside the database function, then audited. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe();
  if (me && mfaBlocked(me)) return NextResponse.json({ error: "mfa_required" }, { status: 403 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (!body.success) return NextResponse.json({ error: "reason_required" }, { status: 400 });
  const { error } = await admin().rpc("rpc_apply_override", {
    p_actor: me.id, p_session: id, p_enrollment: body.data.enrollmentId, p_status: body.data.status, p_reason: body.data.reason });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  // "Record changed by a teacher or admin": the student and the school admins are told (cannot be switched off).
  const sb = admin();
  const [{ data: enr }, { data: ses }] = await Promise.all([sb.from("enrollments").select("student_id").eq("id", body.data.enrollmentId).maybeSingle(), sb.from("sessions").select("org_id, title").eq("id", id).maybeSingle()]);
  if (enr && ses) {
    const label = body.data.status.replace("_", " ");
    await notifyMany([enr.student_id], { org: ses.org_id, kind: "attendance.changed", title: "Your attendance record was changed", body: `"${ses.title}" is now ${label}. Reason: ${body.data.reason}`, critical: true, channels: ["push"] });
    await notifyMany((await schoolAdminsOf(ses.org_id)).filter((a) => a !== me.id), { org: ses.org_id, kind: "attendance.changed", title: "Attendance record overridden", body: `"${ses.title}" set to ${label}. Reason: ${body.data.reason}`, critical: true });
  }
  return NextResponse.json({ ok: true });
}
