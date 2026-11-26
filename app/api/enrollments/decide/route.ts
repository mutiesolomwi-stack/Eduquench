import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const me = await getMe();
  const b = z.object({ enrollmentId: z.string().uuid(), approve: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { error } = await admin().rpc("rpc_decide_enrollment", { p_actor: me.id, p_enrollment: b.data.enrollmentId, p_approve: b.data.approve });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
