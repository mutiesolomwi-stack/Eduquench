"use client";
import { useEffect, useRef, useState } from "react";

interface Check { id: string; type: string; expires_at: string }

/** For live sessions: submit the rotating code, send visible-tab heartbeats, and answer random checks.
 *  Polls every 10 s so it works without sockets or push; push and Realtime make delivery faster. */
export function LiveCheck({ sessionIds }: { sessionIds: string[] }) {
  const sid = sessionIds[0];
  const [checks, setChecks] = useState<Check[]>([]); const [msg, setMsg] = useState(""); const [code, setCode] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!sid) return;
    const tick = async () => {
      if (document.visibilityState === "visible") fetch(`/api/sessions/${sid}/heartbeat`, { method: "POST" }).catch(() => {});
      const r = await fetch(`/api/sessions/${sid}/checks`).then((x) => x.json()).catch(() => null);
      if (r?.checks) setChecks(r.checks);
    };
    tick(); timer.current = setInterval(tick, 10_000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [sid]);
  if (!sid) return null;
  async function answer(id: string) {
    const r = await fetch(`/api/sessions/${sid}/checks/${id}`, { method: "POST" });
    setMsg(r.ok ? "Thanks, check passed." : "That check expired."); setChecks((c) => c.filter((x) => x.id !== id));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch(`/api/sessions/${sid}/code`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Code accepted." : j.error === "wrong_code" ? "That code is not right. Check the teacher's screen." : j.error === "already_used_this_round" ? "Wait for the next code." : "Could not submit the code."); if (r.ok) setCode("");
  }
  return (
    <section className="card" aria-live="polite" aria-label="Live class">
      <h2>Live class</h2>
      {checks.map((c) => (<div key={c.id} className="row"><strong>Quick check: are you here?</strong><button className="btn big" onClick={() => answer(c.id)}>I'm here</button></div>))}
      <form onSubmit={submit} className="row"><div style={{ flex: 1 }}><label htmlFor="live-code">Code from your teacher</label><input id="live-code" inputMode="numeric" pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></div><button className="btn" type="submit">Submit</button></form>
      {msg && <p>{msg}</p>}
    </section>
  );
}
