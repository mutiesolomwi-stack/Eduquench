import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe, mfaBlocked } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { notifyMany } from "@/lib/notify/send";

export async function POST(req: NextRequest) {
  const me = await getMe();
  if (me && mfaBlocked(me)) return NextResponse.json({ error: "mfa_required" }, { status: 403 });
  const b = z.object({ enrollmentId: z.string().uuid(), approve: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { error } = await admin().rpc("rpc_decide_enrollment", { p_actor: me.id, p_enrollment: b.data.enrollmentId, p_approve: b.data.approve });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  const { data: e } = await admin().from("enrollments").select("student_id, org_id, classes(name)").eq("id", b.data.enrollmentId).maybeSingle();
  if (e) await notifyMany([e.student_id], { org: e.org_id, kind: "enrollment.decided", title: b.data.approve ? "You are approved" : "Request declined",
    body: b.data.approve ? "Your join request was approved. Pay the class fee by M-Pesa to start joining lessons." : "Your join request was declined. Ask your teacher if you think this is a mistake.", critical: true, channels: ["email", "push"] });
  return NextResponse.json({ ok: true });
}
