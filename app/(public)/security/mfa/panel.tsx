"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export function MfaPanel({ aal }: { aal: string }) {
  const sb = supabaseBrowser();
  const [factorId, setFactorId] = useState<string | null>(null); const [enrolling, setEnrolling] = useState<{ qr: string; secret: string; id: string } | null>(null);
  const [code, setCode] = useState(""); const [msg, setMsg] = useState("");
  useEffect(() => { sb.auth.mfa.listFactors().then(({ data }) => setFactorId(data?.totp?.[0]?.id ?? null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    if (error || !data) return setMsg("Could not start set-up. Try again.");
    setEnrolling({ qr: data.totp.qr_code, secret: data.totp.secret, id: data.id });
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); const id = enrolling?.id ?? factorId; if (!id) return;
    const ch = await sb.auth.mfa.challenge({ factorId: id });
    if (ch.error) return setMsg("Could not start the check. Try again.");
    const v = await sb.auth.mfa.verify({ factorId: id, challengeId: ch.data.id, code });
    if (v.error) return setMsg("That code is not right. Wait for the next one and try again.");
    window.location.href = "/overview"; // new session token now carries aal2
  }
  if (aal === "aal2") return <p className="badge ok" role="status">Two-factor is active for this session.</p>;
  return (
    <div className="card" style={{ maxWidth: 480 }}>
      {!factorId && !enrolling && <button className="btn big" onClick={start}>Set up authenticator app</button>}
      {enrolling && (<><p>Scan this code with your authenticator app, or enter the key by hand.</p><img src={enrolling.qr} alt="QR code for your authenticator app" width={200} height={200} /><p><code>{enrolling.secret}</code></p></>)}
      {(factorId || enrolling) && (<form onSubmit={verify}><label htmlFor="otp">6-digit code</label><input id="otp" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
        <p><button className="btn big" type="submit">Verify</button></p></form>)}
      {msg && <p className="err" role="alert">{msg}</p>}
    </div>
  );
}
