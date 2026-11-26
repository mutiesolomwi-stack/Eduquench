import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { deviceState } from "@/lib/device";
import { tooMany, windowIsOpen } from "@/lib/access";

/** Sent while the Eduquench tab is visible. Evidence only: never a status by itself. */
export async function POST(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getMe();
  if (!me) return NextResponse.json({ error: "signin" }, { status: 401 });
  if (tooMany(`hb:${me.id}`, 6, 60_000)) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  if ((await deviceState(me.id)) !== "active") return NextResponse.json({ error: "device" }, { status: 403 });
  if (!(await windowIsOpen(id))) return NextResponse.json({ error: "window_closed" }, { status: 409 });
  await admin().rpc("rpc_record_event", { p_session: id, p_student: me.id, p_type: "heartbeat", p_meta: {} });
  return NextResponse.json({ ok: true });
}
