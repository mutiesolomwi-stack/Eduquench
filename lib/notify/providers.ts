import "server-only";
import webpush from "web-push";
import type { OutboxRow, SendResult } from "./outbox";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export async function sendEmail(row: OutboxRow): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY, from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, permanent: false, error: "email provider not configured" };
  const title = String(row.payload.title ?? "Eduquench"), body = String(row.payload.body ?? "");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [row.recipient], subject: title, text: `${body}\n\n${process.env.APP_URL ?? ""}/dashboard`,
      html: `<div style="font-family:system-ui,sans-serif"><h2 style="color:#0B3D91">${esc(title)}</h2><p>${esc(body)}</p></div>` }),
  }).catch(() => null);
  if (!r) return { ok: false, permanent: false, error: "network error" };
  if (r.ok) return { ok: true };
  // 429 and 5xx are worth retrying; other 4xx (bad address, bad key) will not fix themselves.
  return { ok: false, permanent: r.status >= 400 && r.status < 500 && r.status !== 429, error: `email provider ${r.status}` };
}

let vapidReady = false;
export async function sendPush(row: OutboxRow): Promise<SendResult> {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY, subj = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subj) return { ok: false, permanent: false, error: "push not configured" };
  if (!vapidReady) { webpush.setVapidDetails(subj, pub, priv); vapidReady = true; }
  try {
    await webpush.sendNotification({ endpoint: row.recipient, keys: { p256dh: String(row.payload.p256dh), auth: String(row.payload.auth) } },
      JSON.stringify({ title: row.payload.title, body: row.payload.body, url: row.payload.url ?? "/dashboard" }), { TTL: 120, urgency: "high" });
    return { ok: true };
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode ?? 0;
    if (status === 404 || status === 410) return { ok: false, permanent: true, dropEndpoint: true, error: `push gone ${status}` };
    return { ok: false, permanent: status >= 400 && status < 500 && status !== 429, error: `push ${status || "error"}` };
  }
}

export const sendRow = (row: OutboxRow): Promise<SendResult> =>
  row.channel === "email" ? sendEmail(row) : row.channel === "push" ? sendPush(row)
  : Promise.resolve({ ok: false, permanent: true, error: `channel ${row.channel} is not enabled in the MVP` });
