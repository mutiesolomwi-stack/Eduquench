import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

/** Free access with a mandatory reason. School admin or system admin only; late-payment grants need the system admin. */
export async function POST(req: NextRequest) {
  const me = await getMe();
  const b = z.object({
    classId: z.string().uuid(), studentId: z.string().uuid(), reason: z.string().trim().min(3).max(500),
    kind: z.enum(["scholarship", "staff", "trial", "sponsored", "late_payment"]), days: z.number().int().min(1).max(366).nullable().default(null),
  }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { error } = await admin().rpc("rpc_grant_exemption", { p_actor: me.id, p_class: b.data.classId, p_student: b.data.studentId, p_kind: b.data.kind, p_reason: b.data.reason, p_days: b.data.days });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
