"use client";
import { useEffect, useState } from "react";

const b64 = (s: string) => { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

/** Reminders and random checks arrive as push notifications, so students are warned before a session if they are off.
 *  iPhones only get push after the app is added to the Home Screen. */
export function PushSetup() {
  const [state, setState] = useState<"checking" | "on" | "off" | "denied" | "needs-install" | "unsupported">("checking");
  useEffect(() => {
    const ios = /iphone|ipad/i.test(navigator.userAgent), standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (ios && !standalone) return setState("needs-install");
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setState(s && Notification.permission === "granted" ? "on" : "off")).catch(() => setState("off"));
  }, []);
  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!) });
    const j = sub.toJSON();
    const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys }) });
    setState(r.ok ? "on" : "off");
  }
  if (state === "checking" || state === "on") return null;
  return (
    <section className="card" role="status" style={{ borderLeft: "4px solid var(--color-warning)" }}>
      <strong>Turn on notifications before your lesson</strong>
      {state === "needs-install" && <p>On iPhone, tap Share, then “Add to Home Screen”, and open Eduquench from there. Without this you will not receive attendance checks.</p>}
      {state === "denied" && <p>Notifications are blocked for Eduquench. Allow them in your browser settings or you will miss attendance checks.</p>}
      {state === "unsupported" && <p>This browser cannot show notifications. Keep the Eduquench tab open during lessons to receive checks.</p>}
      {state === "off" && <><p>Class reminders and attendance checks reach you as notifications, even while you are in the meeting app.</p><button className="btn" onClick={enable}>Turn on notifications</button></>}
    </section>
  );
}
