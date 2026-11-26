import { redirect } from "next/navigation";
import { requireMe, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { z } from "zod";

const Form = z.object({ classId: z.string().uuid(), title: z.string().trim().min(2).max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), meetingUrl: z.string().url().startsWith("https://").optional().or(z.literal("")) });

async function create(formData: FormData) {
  "use server";
  const me = await requireMe();
  if (!hasRole(me, "teacher", "school_admin", "system_admin")) redirect("/dashboard");
  const f = Form.safeParse(Object.fromEntries(formData));
  if (!f.success) redirect("/sessions/new?error=1");
  const { classId, title, date, start, end, meetingUrl } = f.data;
  // Times are entered in East Africa Time (UTC+3, no daylight saving).
  const starts = new Date(`${date}T${start}:00+03:00`), ends = new Date(`${date}T${end}:00+03:00`);
  if (!(ends > starts)) redirect("/sessions/new?error=time");
  const sb = await supabaseServer(); // row-level security decides whether this person may add sessions to this class
  const { data: cls } = await sb.from("classes").select("org_id").eq("id", classId).single();
  const { error } = await sb.from("sessions").insert({ org_id: cls?.org_id, class_id: classId, title, starts_at: starts.toISOString(), ends_at: ends.toISOString(), meeting_url: meetingUrl || null });
  redirect(error ? "/sessions/new?error=denied" : "/sessions");
}

export default async function NewSession({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireMe();
  const { error } = await searchParams;
  const sb = await supabaseServer();
  const { data: classes } = await sb.from("classes").select("id, name").order("name");
  return (
    <form action={create} className="card" style={{ maxWidth: 520 }}>
      <h1>New session</h1>
      {error && <p className="err" role="alert">{error === "time" ? "The end time must be after the start time." : error === "denied" ? "You can't add sessions to that class." : "Check the form and try again."}</p>}
      <label htmlFor="classId">Class</label><select id="classId" name="classId" required>{(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <label htmlFor="title">Title</label><input id="title" name="title" required />
      <label htmlFor="date">Date</label><input id="date" name="date" type="date" required />
      <div className="row"><div style={{ flex: 1 }}><label htmlFor="start">Starts (EAT)</label><input id="start" name="start" type="time" required /></div><div style={{ flex: 1 }}><label htmlFor="end">Ends (EAT)</label><input id="end" name="end" type="time" required /></div></div>
      <label htmlFor="meetingUrl">Meeting link (https)</label><input id="meetingUrl" name="meetingUrl" type="url" placeholder="https://meet.google.com/..." />
      <p><button className="btn big" type="submit">Create session</button></p>
    </form>
  );
}
