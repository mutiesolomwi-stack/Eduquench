"use client";
import { useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";

export function ClaimRow(p: { id: string; student: string; session: string; note: string; current: string | null }) {
  const [reason, setReason] = useState(""); const [status, setStatus] = useState("verified_present"); const [done, setDone] = useState(""); const [err, setErr] = useState("");
  async function decide(approve: boolean) {
    setErr("");
    const r = await fetch("/api/claims/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claimId: p.id, approve, status: approve ? status : undefined, reason }) });
    if (r.ok) setDone(approve ? "Approved" : "Declined"); else setErr((await r.json().catch(() => ({}))).error === "reason_required" ? "Add a reason (at least 3 characters)." : "Could not save.");
  }
  return (
    <div className="card">
      <div className="row"><div><strong>{p.student}</strong><div className="muted">{p.session}</div></div>{p.current && <StatusBadge status={p.current} />}</div>
      <p>“{p.note}”</p>
      {done ? <span className="badge ok">{done}</span> : (<>
        <label htmlFor={`r-${p.id}`}>Your reason (kept in the audit log)</label><input id={`r-${p.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        <label htmlFor={`s-${p.id}`}>If approved, record as</label>
        <select id={`s-${p.id}`} value={status} onChange={(e) => setStatus(e.target.value)}><option value="verified_present">Verified present</option><option value="excused">Excused</option><option value="late">Late</option><option value="left_early">Left early</option><option value="partial">Partial</option></select>
        <p style={{ display: "flex", gap: ".5rem" }}><button className="btn" onClick={() => decide(true)}>Approve</button><button className="btn ghost" onClick={() => decide(false)}>Decline</button></p>
        {err && <p className="err" role="alert">{err}</p>}</>)}
    </div>
  );
}

export function DeviceRow(p: { id: string; student: string; label: string; when: string }) {
  const [state, setState] = useState("");
  async function approve() { const r = await fetch("/api/devices/approve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: p.id }) }); setState(r.ok ? "Approved" : "Could not approve"); }
  return (
    <div className="card row"><div><strong>{p.student}</strong><div className="muted">New {p.label} · asked {new Date(p.when).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" })}. Approving replaces their current device.</div></div>
      {state ? <span className="badge ok">{state}</span> : <button className="btn" onClick={approve}>Approve device</button>}</div>
  );
}
