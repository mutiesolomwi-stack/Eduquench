import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMe } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { normalisePhone } from "@/lib/payments/daraja";
import { safeNext } from "@/lib/terms";

const plus = (p: string) => { const n = normalisePhone(p); return n ? "+" + n : null; };
const Schema = z.object({
  fullName: z.string().trim().min(2).max(120), email: z.string().trim().email(), password: z.string().min(10).max(72).optional(),
  phone: z.string().transform(plus), admission: z.string().trim().min(1).max(40), upi: z.string().trim().max(40).optional(),
  age: z.enum(["under18", "adult"]), guardianName: z.string().trim().max(120).optional(), guardianPhone: z.string().optional().transform((v) => (v ? plus(v) : null)),
});

async function signUp(formData: FormData) {
  "use server";
  const next = safeNext(formData.get("next"));
  const f = Schema.safeParse(Object.fromEntries(formData));
  if (!f.success || !f.data.phone) redirect(`/sign-up?error=check&next=${encodeURIComponent(next)}`);
  const d = f.data;
  const me = await getMe();
  let userId = me?.id, hasSession = !!me;
  if (!me) {
    if (!d.password) redirect(`/sign-up?error=check&next=${encodeURIComponent(next)}`);
    const sb = await supabaseServer();
    const { data, error } = await sb.auth.signUp({ email: d.email, password: d.password, options: { emailRedirectTo: `${process.env.APP_URL}/sign-in` } });
    if (error || !data.user) redirect(`/sign-up?error=account&next=${encodeURIComponent(next)}`);
    userId = data.user.id; hasSession = !!data.session;
  }
  const { error } = await admin().rpc("rpc_complete_profile", {
    p_user: userId, p_full_name: d.fullName, p_phone: d.phone, p_email: d.email, p_admission: d.admission, p_upi: d.upi ?? null,
    p_is_minor: d.age === "under18", p_guardian_name: d.guardianName ?? null, p_guardian_phone: d.guardianPhone ?? null });
  if (error) redirect(`/sign-up?error=${error.code === "22023" ? "guardian" : "profile"}&next=${encodeURIComponent(next)}`);
  redirect(hasSession ? next : `/sign-in?check_email=1&next=${encodeURIComponent(next)}`);
}

const MSG: Record<string, string> = { check: "Check the highlighted details: the phone must be a Kenyan mobile number and the password at least 10 characters.",
  account: "We could not create that account. The email may already be registered: try signing in.", guardian: "Under-18s need a parent or guardian name and phone number.", profile: "We could not save your details. Try again." };

export default async function SignUp({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams; const me = await getMe();
  return (
    <form action={signUp} className="card" style={{ maxWidth: 520, margin: "2rem auto" }}>
      <h1>{me ? "Complete your details" : "Create your account"}</h1>
      {error && <p className="err" role="alert">{MSG[error] ?? MSG.profile}</p>}
      <input type="hidden" name="next" value={safeNext(next)} />
      <label htmlFor="fullName">Full name</label><input id="fullName" name="fullName" autoComplete="name" required />
      <label htmlFor="email">Email (a parent's email is fine if you are under 18)</label><input id="email" name="email" type="email" autoComplete="email" defaultValue={me?.email} required />
      {!me && (<><label htmlFor="password">Password (10 or more characters)</label><input id="password" name="password" type="password" minLength={10} autoComplete="new-password" required /></>)}
      <label htmlFor="phone">Mobile number</label><input id="phone" name="phone" inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" required />
      <label htmlFor="admission">Admission or student number</label><input id="admission" name="admission" required />
      <label htmlFor="upi">Learner ID (UPI), optional</label><input id="upi" name="upi" />
      <fieldset style={{ border: 0, padding: 0, margin: "1rem 0 0" }}><legend style={{ fontWeight: 600 }}>Your age</legend>
        <label><input type="radio" name="age" value="under18" defaultChecked style={{ width: "auto", minHeight: 0 }} /> Under 18</label>
        <label><input type="radio" name="age" value="adult" style={{ width: "auto", minHeight: 0 }} /> 18 or over</label></fieldset>
      <label htmlFor="guardianName">Parent or guardian name (required if under 18)</label><input id="guardianName" name="guardianName" />
      <label htmlFor="guardianPhone">Parent or guardian phone (required if under 18)</label><input id="guardianPhone" name="guardianPhone" inputMode="tel" />
      <p><button className="btn big" type="submit">{me ? "Save" : "Create account"}</button></p>
      {!me && <p className="muted">Already registered? <Link href="/sign-in">Sign in</Link></p>}
    </form>
  );
}
