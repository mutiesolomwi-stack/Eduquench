import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getMe, homeFor } from "@/lib/auth";

async function signIn(formData: FormData) {
  "use server";
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: String(formData.get("email")), password: String(formData.get("password")) });
  if (error) redirect("/sign-in?error=1");
  const me = await getMe();
  redirect(me ? homeFor(me) : "/dashboard");
}

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <form action={signIn} className="card" style={{ maxWidth: 420, margin: "2rem auto" }}>
      <h1>Sign in</h1>
      {error && <p className="err" role="alert">That email or password did not match.</p>}
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required />
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />
      <p><button className="btn big" type="submit">Sign in</button></p>
      <p className="muted">One student, one login. Your first device is registered; a second device needs teacher approval.</p>
    </form>
  );
}
