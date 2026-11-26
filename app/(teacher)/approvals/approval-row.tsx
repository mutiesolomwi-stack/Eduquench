"use client";
import { useState } from "react";

export function ApprovalRow(p: { id: string; student: string; admission: string | null; className: string }) {
  const [done, setDone] = useState<"" | "approved" | "declined" | "error">("");
  async function decide(approve: boolean) {
    const r = await fetch("/api/enrollments/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrollmentId: p.id, approve }) });
    setDone(r.ok ? (approve ? "approved" : "declined") : "error");
  }
  return (
    <div className="card row">
      <div><strong>{p.student}</strong><div className="muted">Admission {p.admission ?? "not given"} · {p.className}</div></div>
      {done ? <span className={`badge ${done === "approved" ? "ok" : done === "declined" ? "neutral" : "bad"}`}>{done === "error" ? "Could not save" : done}</span> : (
        <span style={{ display: "flex", gap: ".5rem" }}><button className="btn" onClick={() => decide(true)}>Approve</button><button className="btn ghost" onClick={() => decide(false)}>Decline</button></span>)}
    </div>
  );
}
