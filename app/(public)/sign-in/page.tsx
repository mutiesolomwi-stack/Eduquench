import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getMe, homeFor } from "@/lib/auth";
import Link from "next/link";
import { safeNext } from "@/lib/terms";

async function signIn(formData: FormData) {
  "use server";
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: String(formData.get("email")), password: String(formData.get("password")) });
  if (error) redirect("/sign-in?error=1");
  const me = await getMe();
  const next = formData.get("next");
  redirect(typeof next === "string" && next.startsWith("/") ? safeNext(next) : me ? homeFor(me) : "/dashboard");
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; check_email?: string; next?: string }> }) {
  const { error, check_email, next } = await searchParams;
  return (
    <form action={signIn} className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
      <h1>Sign in</h1>
      {check_email && <p role="status" className="badge ok">Check your email to confirm your account, then sign in.</p>}
      <input type="hidden" name="next" value={next ?? ""} />
      {error && <p className="err" role="alert">That email or password did not match.</p>}
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />
      <p><button className="btn big" type="submit">Sign in</button></p>
      <p>New here? <Link href={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link></p>
      <p className="muted">One student, one login. Your first device is registered; a second device needs teacher approval.</p>
    </form>
  );
}
