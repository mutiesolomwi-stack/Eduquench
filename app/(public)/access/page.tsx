import { redirect } from "next/navigation";
import { requireMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { sha256, toBytea } from "@/lib/crypto";
import { tooMany } from "@/lib/access";

async function check(formData: FormData) {
  "use server";
  const me = await requireMe();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (tooMany(`acode:${me.id}`, 6, 10 * 60_000) || !/^[A-Z2-9]{8}$/.test(code)) redirect("/access?result=bad");
  const { data } = await admin().rpc("rpc_verify_access_code", { p_student: me.id, p_code_hash: toBytea(sha256(code)) });
  redirect(data ? `/access?result=ok&class=${encodeURIComponent((data as { class_name: string }).class_name)}` : "/access?result=bad");
}

export default async function AccessCode({ searchParams }: { searchParams: Promise<{ result?: string; class?: string }> }) {
  await requireMe();
  const { result, class: cls } = await searchParams;
  return (
    <form action={check} className="card" style={{ maxWidth: 480, margin: "2rem auto" }}>
      <h1>Enter your access code</h1>
      {result === "ok" && <p className="badge ok" role="status">Code accepted for {cls}</p>}
      {result === "bad" && <p className="err" role="alert">That code is not valid for your account.</p>}
      <label htmlFor="code">8-character code from your receipt</label><input id="code" name="code" maxLength={8} autoCapitalize="characters" required />
      <p><button className="btn big" type="submit">Check code</button></p>
    </form>
  );
}
