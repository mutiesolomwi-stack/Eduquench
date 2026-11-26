import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { requireAdminMfa } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { supabaseServer } from "@/lib/supabase/server";
import { InviteBox } from "./invite-box";

const eat = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const Fee = z.object({ kind: z.enum(["full_course", "per_session", "monthly", "instalment"]), name: z.string().trim().min(2).max(80), amount: z.coerce.number().positive().max(1_000_000), sessions: z.coerce.number().int().positive().optional().or(z.literal("").transform(() => undefined)) });
const Tt = z.object({ weekday: z.coerce.number().int().min(1).max(7), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), title: z.string().trim().min(2).max(120) });

async function addFee(id: string, fd: FormData) {
  "use server";
  const me = await requireAdminMfa(); const f = Fee.safeParse(Object.fromEntries(fd));
  if (!f.success) redirect(`/classes/${id}?error=fee`);
  const { error } = await admin().rpc("rpc_create_fee_plan", { p_actor: me.id, p_class: id, p_kind: f.data.kind, p_name: f.data.name, p_amount: f.data.amount, p_sessions: f.data.sessions ?? null });
  redirect(`/classes/${id}${error ? "?error=denied" : ""}`);
}
async function addTimetable(id: string, fd: FormData) {
  "use server";
  const me = await requireAdminMfa(); const f = Tt.safeParse(Object.fromEntries(fd));
  if (!f.success || f.data.end <= f.data.start || f.data.to < f.data.from) redirect(`/classes/${id}?error=timetable`);
  const { data, error } = await admin().rpc("rpc_create_timetable", { p_actor: me.id, p_class: id, p_weekday: f.data.weekday, p_start: f.data.start, p_end: f.data.end, p_from: f.data.from, p_to: f.data.to, p_title: f.data.title });
  redirect(error ? `/classes/${id}?error=denied` : `/classes/${id}?made=${data}`);
}
async function cancelSession(id: string, fd: FormData) {
  "use server";
  const me = await requireAdminMfa();
  await admin().rpc("rpc_cancel_session", { p_actor: me.id, p_session: String(fd.get("sessionId")), p_reason: String(fd.get("reason") ?? "") });
  redirect(`/classes/${id}`);
}

export default async function ManageClass({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; made?: string }> }) {
  const me = await requireAdminMfa(); const { id } = await params; const { error, made } = await searchParams;
  const sb = await supabaseServer();
  const { data: cls } = await sb.from("classes").select("id, name, class_type").eq("id", id).maybeSingle();
  if (!cls) notFound();
  const [{ data: plans }, { data: sessions }] = await Promise.all([
    sb.from("fee_plans").select("id, name, kind, amount").eq("class_id", id).eq("active", true),
    sb.from("sessions").select("id, title, starts_at, status").eq("class_id", id).gte("starts_at", new Date(Date.now() - 86400_000).toISOString()).order("starts_at").limit(30)]);
  const kinds = ["pdf", "csv"];
  return (
    <>
      <h1>{cls.name}</h1>
      {error && <p className="err card" role="alert">{error === "denied" ? "You don't have permission for that." : "Check the form and try again."}</p>}
      {made && <p className="badge ok" role="status">{made} sessions created (existing slots and holidays are skipped).</p>}
      <section className="card"><h2>Join link</h2><InviteBox classId={id} /></section>
      <section className="card"><h2>Fees</h2>
        {(plans ?? []).map((p) => <div className="row" key={p.id}><span>{p.name} · {p.kind.replace("_", " ")}</span><strong>KES {Number(p.amount).toLocaleString("en-KE")}</strong></div>)}
        <form action={addFee.bind(null, id)}><div className="row" style={{ alignItems: "end" }}>
          <div><label htmlFor="fname">Name</label><input id="fname" name="name" required /></div>
          <div><label htmlFor="kind">Kind</label><select id="kind" name="kind"><option value="full_course">Full course</option><option value="per_session">Per session</option><option value="monthly">Monthly</option><option value="instalment">Instalment</option></select></div>
          <div><label htmlFor="amount">Amount (KES)</label><input id="amount" name="amount" type="number" min="1" step="1" required /></div>
          <div><label htmlFor="sessions">Sessions covered</label><input id="sessions" name="sessions" type="number" min="1" /></div>
          <button className="btn" type="submit">Add fee</button></div></form></section>
      <section className="card"><h2>Timetable</h2><p className="muted">Creates one session per matching day, skipping school holidays. Times are East Africa Time.</p>
        <form action={addTimetable.bind(null, id)}><div className="row" style={{ alignItems: "end" }}>
          <div><label htmlFor="title">Session title</label><input id="title" name="title" required /></div>
          <div><label htmlFor="weekday">Day</label><select id="weekday" name="weekday">{["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></div>
          <div><label htmlFor="start">Starts</label><input id="start" name="start" type="time" required /></div><div><label htmlFor="end">Ends</label><input id="end" name="end" type="time" required /></div>
          <div><label htmlFor="from">From</label><input id="from" name="from" type="date" required /></div><div><label htmlFor="to">To</label><input id="to" name="to" type="date" required /></div>
          <button className="btn" type="submit">Create sessions</button></div></form></section>
      <section className="card"><h2>Upcoming sessions</h2>
        {(sessions ?? []).map((s) => <form key={s.id} action={cancelSession.bind(null, id)} className="row"><span>{eat.format(new Date(s.starts_at))} · {s.title} · {s.status}</span>
          {s.status === "scheduled" && <span style={{ display: "flex", gap: ".5rem" }}><input type="hidden" name="sessionId" value={s.id} /><input name="reason" placeholder="Reason (students are told)" aria-label="Reason for cancelling" /><button className="btn ghost" type="submit">Cancel</button></span>}</form>)}</section>
      <section className="card" id="reports"><h2>Reports</h2>
        {[["attendance", "Attendance sheet"], ["summary", "Student summary"], ["late-early", "Late and early departures"], ["overrides", "Overrides and exceptions"], ["payment-vs-attendance", "Payment versus attendance"], ["payments", "Payments and reconciliation"]].map(([k, label]) =>
          <div className="row" key={k}><span>{label}</span><span style={{ display: "flex", gap: ".5rem" }}>{kinds.map((f) => <a key={f} className="btn ghost" href={`/api/reports/${k}?classId=${id}&format=${f}`}>{f.toUpperCase()}</a>)}</span></div>)}</section>
    </>
  );
}
