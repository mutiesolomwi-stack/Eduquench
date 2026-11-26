/** Pure report builders. Inputs are plain rows (already limited by row-level security); outputs are table rows. */
export interface Rec { session_id: string; student_id: string; effective_status: string; computed_status: string; seconds_present: number; late_minutes: number; early_minutes: number; checks_sent: number; checks_passed: number; confidence: string }
export interface Person { id: string; full_name: string; admission_no: string | null }
export interface Sess { id: string; title: string; starts_at: string }

const ATTENDED = new Set(["verified_present", "late", "left_early", "excused"]);
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const nameOf = (m: Map<string, Person>, id: string) => m.get(id)?.full_name ?? "Unknown";
const byId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

export function attendanceSheet(recs: Rec[], people: Person[], sessions: Sess[]) {
  const P = byId(people), S = byId(sessions);
  return [...recs].sort((a, b) => (S.get(a.session_id)?.starts_at ?? "").localeCompare(S.get(b.session_id)?.starts_at ?? "") || nameOf(P, a.student_id).localeCompare(nameOf(P, b.student_id)))
    .map((r) => ({
      date: S.get(r.session_id)?.starts_at.slice(0, 10) ?? "", session: S.get(r.session_id)?.title ?? "", student: nameOf(P, r.student_id), admission: P.get(r.student_id)?.admission_no ?? "",
      status: r.effective_status, computed: r.computed_status, minutes_present: Math.round(r.seconds_present / 60), late_min: r.late_minutes, early_min: r.early_minutes,
      checks: `${r.checks_passed}/${r.checks_sent}`, confidence: r.confidence }));
}

export function studentSummary(recs: Rec[], people: Person[]) {
  const P = byId(people), per = new Map<string, Rec[]>();
  for (const r of recs) per.set(r.student_id, [...(per.get(r.student_id) ?? []), r]);
  return [...per].map(([id, rs]) => {
    const c = (s: string) => rs.filter((r) => r.effective_status === s).length;
    const attended = rs.filter((r) => ATTENDED.has(r.effective_status)).length;
    return { student: nameOf(P, id), admission: P.get(id)?.admission_no ?? "", sessions: rs.length, attended, attendance_pct: pctOf(attended, rs.length),
      verified: c("verified_present"), late: c("late"), left_early: c("left_early"), partial: c("partial"), pending: c("pending_review"), excused: c("excused"), absent: c("absent") };
  }).sort((a, b) => a.student.localeCompare(b.student));
}

export function lateEarly(recs: Rec[], people: Person[]) {
  const P = byId(people), per = new Map<string, { late: number[]; early: number[] }>();
  for (const r of recs) {
    const e = per.get(r.student_id) ?? { late: [], early: [] };
    if (r.late_minutes > 0) e.late.push(r.late_minutes);
    if (r.early_minutes > 0) e.early.push(r.early_minutes);
    per.set(r.student_id, e);
  }
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return [...per].filter(([, e]) => e.late.length || e.early.length).map(([id, e]) => ({
    student: nameOf(P, id), late_count: e.late.length, late_minutes_total: sum(e.late), left_early_count: e.early.length, early_minutes_total: sum(e.early) }))
    .sort((a, b) => b.late_minutes_total + b.early_minutes_total - (a.late_minutes_total + a.early_minutes_total));
}

export interface Ovr { session_id: string; enrollment_id: string; student_id?: string; status: string; reason: string; author_id: string; created_at: string }
export function overrideReport(ovr: Ovr[], people: Person[], sessions: Sess[], enrolToStudent: Map<string, string>) {
  const P = byId(people), S = byId(sessions);
  return [...ovr].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((o) => ({
    when: o.created_at.replace("T", " ").slice(0, 16), session: S.get(o.session_id)?.title ?? "", student: nameOf(P, enrolToStudent.get(o.enrollment_id) ?? ""),
    new_status: o.status, reason: o.reason, author: nameOf(P, o.author_id) }));
}

export interface Pay { id: string; payer_id: string; beneficiary_id: string; mpesa_receipt: string; amount: number | string; state: string; paid_at: string }
export interface Ent { student_id: string; payment_id: string | null; exemption_id: string | null; status: string }

export function paymentVsAttendance(approvedStudentIds: string[], ents: Ent[], pays: Pay[], recs: Rec[], people: Person[]) {
  const P = byId(people);
  const payBy = new Map<string, number>(); for (const p of pays) payBy.set(p.beneficiary_id, (payBy.get(p.beneficiary_id) ?? 0) + Number(p.amount));
  const exempt = new Set(ents.filter((e) => e.exemption_id && e.status === "active").map((e) => e.student_id));
  const attendedBy = new Map<string, number>(); for (const r of recs) if (ATTENDED.has(r.effective_status)) attendedBy.set(r.student_id, (attendedBy.get(r.student_id) ?? 0) + 1);
  return approvedStudentIds.map((id) => {
    const paid = payBy.get(id) ?? 0, free = exempt.has(id), att = attendedBy.get(id) ?? 0;
    const flag = !paid && !free && att > 0 ? "Attended without payment or exemption" : paid && !att ? "Paid but never attended" : !paid && !free ? "Not paid" : "";
    return { student: nameOf(P, id), admission: P.get(id)?.admission_no ?? "", paid_kes: paid, free_access: free ? "yes" : "", sessions_attended: att, flag };
  }).sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || a.student.localeCompare(b.student));
}

export function paymentsRecon(pays: Pay[], people: Person[], commissionPct: number | null) {
  const P = byId(people);
  return [...pays].sort((a, b) => a.paid_at.localeCompare(b.paid_at)).map((p) => {
    const amt = Number(p.amount), comm = commissionPct === null ? "" : Math.round(amt * commissionPct) / 100;
    return { paid_at: p.paid_at.replace("T", " ").slice(0, 16), receipt: p.mpesa_receipt, payer: nameOf(P, p.payer_id), beneficiary: nameOf(P, p.beneficiary_id), amount_kes: amt, state: p.state, commission_kes: comm, school_share_kes: comm === "" ? "" : amt - comm };
  });
}
