import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { deviceState } from "@/lib/device";
import { newLinkToken, sha256, toBytea } from "@/lib/crypto";
import { tooMany } from "@/lib/access";

/** Join gateway: login, membership, entitlement, device and time window are all checked before a
 *  join event is written and a single-use token is minted. The meeting link is never sent to the browser. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const back = (reason: string) => NextResponse.redirect(new URL(`/dashboard?join_error=${reason}`, req.url), 303);
  const me = await getMe();
  if (!me) return NextResponse.redirect(new URL(`/sign-in?next=/dashboard`, req.url), 303);
  if (tooMany(`join:${me.id}`, 10, 60_000)) return back("slow_down");

  const sb = admin();
  const device = await deviceState(me.id);
  if (device !== "active") return back(device === "pending" ? "device_pending" : "device_unknown");

  const { data: verdict } = await sb.rpc("rpc_check_join", { p_student: me.id, p_session: id });
  if (verdict !== "ok") return back(String(verdict ?? "denied"));

  const token = newLinkToken();
  const h = toBytea(sha256(token));
  await sb.rpc("rpc_mint_join_token", { p_session: id, p_student: me.id, p_token_hash: h, p_minutes: 5 });
  await sb.rpc("rpc_record_event", { p_session: id, p_student: me.id, p_type: "join", p_meta: { via: "gateway" } });
  return NextResponse.redirect(new URL(`/api/join/go?t=${token}`, req.url), 303);
}
