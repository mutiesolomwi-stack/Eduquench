import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { newLinkToken, sha256, toBytea } from "@/lib/crypto";

/** Create a join link for one class. The plaintext token is shown once and only its hash is stored. */
export async function POST(req: NextRequest) {
  const me = await getMe();
  const b = z.object({ classId: z.string().uuid(), days: z.number().int().min(1).max(90).default(14) }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const token = newLinkToken();
  const { error } = await admin().rpc("rpc_create_invitation", { p_actor: me.id, p_class: b.data.classId, p_token_hash: toBytea(sha256(token)), p_days: b.data.days });
  if (error) return NextResponse.json({ error: error.code === "42501" ? "forbidden" : "failed" }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json({ url: `${process.env.APP_URL}/join/${token}`, expiresInDays: b.data.days });
}
