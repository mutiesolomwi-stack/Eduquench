"use client";
import { useEffect, useState } from "react";

export function SessionControls({ sessionId, status }: { sessionId: string; status: string }) {
  const [st, setSt] = useState(status); const [code, setCode] = useState<{ code: string; secondsLeft: number } | null>(null); const [msg, setMsg] = useState("");
  useEffect(() => {
    if (st !== "live") return;
    const load = () => fetch(`/api/sessions/${sessionId}/code`, { cache: "no-store" }).then((r) => r.json()).then((j) => j.code && setCode(j)).catch(() => {});
    load(); const t = setInterval(load, 5_000); return () => clearInterval(t);
  }, [st, sessionId]);
  async function act(action: "open" | "close") {
    const r = await fetch(`/api/sessions/${sessionId}/window`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (r.ok) { setSt(action === "open" ? "live" : "ended"); setMsg(action === "open" ? "Attendance is open." : "Attendance closed and statuses computed."); if (action === "close") setCode(null); }
    else setMsg((await r.json().catch(() => ({}))).error ?? "Something went wrong.");
  }
  return (
    <div>
      {st === "live" && code && (<div aria-live="polite"><div className="muted">Read this code out or show it in the meeting</div><div className="code">{code.code}</div><div className="muted">changes in {code.secondsLeft}s</div></div>)}
      <div className="row" style={{ justifyContent: "flex-start" }}>
        {st === "scheduled" && <button className="btn big" onClick={() => act("open")}>Start attendance</button>}
        {st === "live" && <button className="btn big" onClick={() => act("close")}>End attendance</button>}
      </div>
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}
