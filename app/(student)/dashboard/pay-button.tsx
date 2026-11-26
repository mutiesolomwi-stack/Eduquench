"use client";
import { useState } from "react";

export function PayButton({ feePlanId }: { feePlanId: string }) {
  const [phone, setPhone] = useState(""); const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  async function pay(e: React.FormEvent) {
    e.preventDefault(); setState("sending");
    const r = await fetch("/api/payments/stk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feePlanId, phone }) });
    setState(r.ok ? "sent" : "error");
  }
  return (
    <form onSubmit={pay} style={{ display: "flex", gap: ".5rem", alignItems: "end", flexWrap: "wrap" }}>
      <div><label htmlFor={`ph-${feePlanId}`}>M-Pesa number</label><input id={`ph-${feePlanId}`} inputMode="tel" autoComplete="tel" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} required /></div>
      <button className="btn" disabled={state === "sending"} type="submit">{state === "sending" ? "Sending…" : "Pay with M-Pesa"}</button>
      <div aria-live="polite">{state === "sent" && <span className="badge ok">Check your phone and enter your PIN</span>}{state === "error" && <span className="err">Could not start payment. Check the number and try again.</span>}</div>
    </form>
  );
}
