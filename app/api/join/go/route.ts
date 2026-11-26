import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { sha256, toBytea } from "@/lib/crypto";

/** Redeems a single-use join token (bound to the signed-in student) and sends them to the meeting. */
export async function GET(req: NextRequest) {
  const me = await getMe();
  const t = req.nextUrl.searchParams.get("t") ?? "";
  if (!me || !/^[A-Za-z0-9_-]{20,30}$/.test(t)) return NextResponse.redirect(new URL("/dashboard?join_error=invalid_link", req.url), 303);
  const { data: url } = await admin().rpc("rpc_consume_join_token", { p_token_hash: toBytea(sha256(t)), p_student: me.id });
  if (!url) return NextResponse.redirect(new URL("/dashboard?join_error=link_used_or_expired", req.url), 303);
  const res = NextResponse.redirect(String(url), 303);
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}
