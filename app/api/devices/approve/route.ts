import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const me = await getMe();
  const body = z.object({ deviceId: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!me || !body.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const { error } = await admin().rpc("rpc_approve_device", { p_actor: me.id, p_device: body.data.deviceId });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ ok: true });
}
