"use client";
import { useState } from "react";

export function ClaimForm({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false); const [note, setNote] = useState(""); const [msg, setMsg] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/claims", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, note }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Sent to your teacher. This session now shows as Pending." : j.error === "already_pending" ? "You already sent a request for this session." : j.error === "not_open" ? "Requests open after the session and for 7 days." : "Could not send. Try again.");
    if (r.ok) setOpen(false);
  }
  if (!open) return <><button className="btn ghost" type="button" onClick={() => setOpen(true)}>I had connection problems</button>{msg && <div role="status">{msg}</div>}</>;
  return (<form onSubmit={send}><label htmlFor={`n-${sessionId}`}>What happened? (a short note for your teacher)</label><textarea id={`n-${sessionId}`} value={note} onChange={(e) => setNote(e.target.value)} minLength={3} maxLength={500} required />
    <p style={{ display: "flex", gap: ".5rem" }}><button className="btn" type="submit">Send request</button><button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button></p></form>);
}
