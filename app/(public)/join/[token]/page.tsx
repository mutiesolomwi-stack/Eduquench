import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { sha256, toBytea } from "@/lib/crypto";

async function request(formData: FormData) {
  "use server";
  const me = await getMe(); const token = String(formData.get("token") ?? "");
  if (!me) redirect(`/sign-in?next=/join/${encodeURIComponent(token)}`);
  const { data } = await admin().rpc("rpc_redeem_invitation", { p_student: me.id, p_token_hash: toBytea(sha256(token)) });
  redirect(data ? "/dashboard?requested=1" : `/join/${encodeURIComponent(token)}?invalid=1`);
}

export default async function JoinLink({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ invalid?: string }> }) {
  const { token } = await params; const { invalid } = await searchParams;
  return (
    <form action={request} className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
      <h1>Join a class</h1>
      {invalid && <p className="err" role="alert">This link is not valid or has expired. Ask your teacher for a new one.</p>}
      <p>Your request goes to the teacher for approval. After approval you pay the class fee by M-Pesa and can join lessons.</p>
      <input type="hidden" name="token" value={token} />
      <button className="btn big" type="submit">Request to join</button>
    </form>
  );
}
