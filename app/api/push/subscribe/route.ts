import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  const me = await getMe();
  const b = z.object({ endpoint: z.string().url().startsWith("https://").max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const sb = admin();
  await sb.from("push_subscriptions").delete().eq("endpoint", b.data.endpoint); // a shared device moves to the signed-in user
  const { error } = await sb.from("push_subscriptions").insert({ user_id: me.id, endpoint: b.data.endpoint, p256dh: b.data.keys.p256dh, auth: b.data.keys.auth });
  return error ? NextResponse.json({ error: "failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}
