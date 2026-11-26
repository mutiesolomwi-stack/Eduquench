"use client";
import { useState } from "react";

export function InviteBox({ classId }: { classId: string }) {
  const [url, setUrl] = useState(""); const [msg, setMsg] = useState("");
  async function make() {
    setMsg("");
    const r = await fetch("/api/invitations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classId, days: 14 }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setUrl(j.url); else setMsg(j.error === "mfa_required" ? "Set up two-factor sign-in first." : "Could not create the link.");
  }
  return (
    <div aria-live="polite">
      <button className="btn" onClick={make} type="button">Create a 14-day join link</button>
      {url && (<p><input readOnly value={url} aria-label="Join link" onFocus={(e) => e.currentTarget.select()} /><span className="muted">Shown once. Share it with students; each still needs approval and payment.</span></p>)}
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}
