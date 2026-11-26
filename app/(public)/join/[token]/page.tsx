import { redirect } from "next/navigation";
import Link from "next/link";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { sha256, toBytea } from "@/lib/crypto";
import { TERMS_VERSION } from "@/lib/terms";

async function request(formData: FormData) {
  "use server";
  const me = await getMe(); const token = String(formData.get("token") ?? "");
  const here = `/join/${encodeURIComponent(token)}`;
  if (!me) redirect(`/sign-in?next=${encodeURIComponent(here)}`);
  const sb = admin(), hash = toBytea(sha256(token));
  const { data: info } = await sb.rpc("rpc_invitation_org", { p_token_hash: hash });
  const org = (info as { org_id: string } | null)?.org_id;
  if (!org) redirect(`${here}?invalid=1`);
  const { data: prof } = await sb.from("profiles").select("is_minor").eq("id", me.id).maybeSingle();
  if (!prof) redirect(`/sign-up?next=${encodeURIComponent(here)}`);
  if (formData.get("terms") !== "on" || (prof.is_minor && formData.get("guardian") !== "on")) redirect(`${here}?consent=1`);
  await sb.rpc("rpc_record_consent", { p_user: me.id, p_org: org, p_kind: "terms", p_version: TERMS_VERSION });
  if (prof.is_minor) await sb.rpc("rpc_record_consent", { p_user: me.id, p_org: org, p_kind: "guardian", p_version: TERMS_VERSION });
  const { data } = await sb.rpc("rpc_redeem_invitation", { p_student: me.id, p_token_hash: hash });
  redirect(data ? "/dashboard?requested=1" : `${here}?invalid=1`);
}

export default async function JoinLink({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ invalid?: string; consent?: string }> }) {
  const { token } = await params; const { invalid, consent } = await searchParams;
  const me = await getMe();
  const { data: info } = await admin().rpc("rpc_invitation_org", { p_token_hash: toBytea(sha256(token)) });
  const i = info as { org_name: string; class_name: string } | null;
  const minor = me ? (await (await supabaseServer()).from("profiles").select("is_minor").eq("id", me.id).maybeSingle()).data?.is_minor ?? true : true;
  return (
    <form action={request} className="card" style={{ maxWidth: 520, margin: "2rem auto" }}>
      <h1>Join a class</h1>
      {invalid || !i ? <p className="err" role="alert">This link is not valid or has expired. Ask your teacher for a new one.</p> : <p><strong>{i.class_name}</strong> at {i.org_name}</p>}
      {consent && <p className="err" role="alert">Please tick the consent box{minor ? "es" : ""} to continue.</p>}
      <p>Your request goes to the teacher for approval. After approval you pay the class fee by M-Pesa and can join lessons.</p>
      <label style={{ display: "flex", gap: ".5rem", alignItems: "start", fontWeight: 400 }}><input type="checkbox" name="terms" style={{ width: "auto", minHeight: 0, marginTop: 6 }} />
        <span>I accept the terms of use and privacy notice (version {TERMS_VERSION}). Eduquench keeps only the details it needs to run classes, payments and attendance.</span></label>
      {minor && <label style={{ display: "flex", gap: ".5rem", alignItems: "start", fontWeight: 400 }}><input type="checkbox" name="guardian" style={{ width: "auto", minHeight: 0, marginTop: 6 }} />
        <span>My parent or guardian has agreed to my taking part and to these terms.</span></label>}
      <input type="hidden" name="token" value={token} />
      {!me && <p className="muted">You will be asked to sign in or <Link href={`/sign-up?next=${encodeURIComponent(`/join/${token}`)}`}>create an account</Link> first.</p>}
      <button className="btn big" type="submit" disabled={!i}>Request to join</button>
    </form>
  );
}
