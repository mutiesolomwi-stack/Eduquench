import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { tooMany } from "@/lib/access";

/** Student: "I had connection problems". Opens a review for the teacher; the record shows Pending until decided. */
export async function POST(req: NextRequest) {
  const me = await getMe();
  const b = z.object({ sessionId: z.string().uuid(), note: z.string().trim().min(3).max(500) }).safeParse(await req.json().catch(() => null));
  if (!me || !b.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (tooMany(`claim:${me.id}`, 5, 60 * 60_000)) return NextResponse.json({ error: "slow_down" }, { status: 429 });
  const { error } = await admin().rpc("rpc_submit_claim", { p_student: me.id, p_session: b.data.sessionId, p_note: b.data.note });
  if (error) { const m: Record<string, [string, number]> = { "42501": ["not_enrolled", 403], "23505": ["already_pending", 409], "22023": ["not_open", 422] }; const [e, s] = m[error.code ?? ""] ?? ["failed", 400]; return NextResponse.json({ error: e }, { status: s }); }
  return NextResponse.json({ ok: true });
}
