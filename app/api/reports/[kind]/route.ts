import { NextResponse, type NextRequest } from "next/server";
import { getMe, hasRole, mfaBlocked } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { toCsv } from "@/lib/reports/csv";
import { tablePdf } from "@/lib/reports/pdf";
import * as R from "@/lib/reports/build";

type Col = { key: string; header: string; width: number };
const COLS: Record<string, { title: string; cols: Col[] }> = {
  attendance: { title: "Class attendance sheet", cols: [["date", "Date", 2], ["session", "Session", 3], ["student", "Student", 3], ["admission", "Adm.", 1.5], ["status", "Status", 2], ["computed", "Computed", 2], ["minutes_present", "Min present", 1.5], ["late_min", "Late", 1], ["early_min", "Early", 1], ["checks", "Checks", 1.2], ["confidence", "Conf.", 1.2]].map(([key, header, width]) => ({ key, header, width }) as Col) },
  summary: { title: "Student attendance summary", cols: [["student", "Student", 3], ["admission", "Adm.", 1.5], ["sessions", "Sessions", 1.2], ["attended", "Attended", 1.2], ["attendance_pct", "%", 1], ["verified", "Verified", 1.2], ["late", "Late", 1], ["left_early", "Left early", 1.3], ["partial", "Partial", 1.1], ["pending", "Pending", 1.1], ["excused", "Excused", 1.2], ["absent", "Absent", 1.1]].map(([key, header, width]) => ({ key, header, width }) as Col) },
  "late-early": { title: "Late and early-departure report", cols: [["student", "Student", 3], ["late_count", "Times late", 1.5], ["late_minutes_total", "Late minutes", 1.5], ["left_early_count", "Times left early", 1.8], ["early_minutes_total", "Early minutes", 1.5]].map(([key, header, width]) => ({ key, header, width }) as Col) },
  overrides: { title: "Override and exception report", cols: [["when", "When", 2], ["session", "Session", 2.5], ["student", "Student", 2.5], ["new_status", "New status", 1.8], ["reason", "Reason", 4], ["author", "Author", 2]].map(([key, header, width]) => ({ key, header, width }) as Col) },
  "payment-vs-attendance": { title: "Payment versus attendance", cols: [["student", "Student", 3], ["admission", "Adm.", 1.5], ["paid_kes", "Paid (KES)", 1.5], ["free_access", "Free access", 1.5], ["sessions_attended", "Attended", 1.3], ["flag", "Flag", 4]].map(([key, header, width]) => ({ key, header, width }) as Col) },
  payments: { title: "Payments and reconciliation", cols: [["paid_at", "Paid at", 2], ["receipt", "Receipt", 1.8], ["payer", "Payer", 2.5], ["beneficiary", "Student", 2.5], ["amount_kes", "Amount", 1.3], ["state", "State", 1.2], ["commission_kes", "Commission", 1.4], ["school_share_kes", "School share", 1.4]].map(([key, header, width]) => ({ key, header, width }) as Col) },
};

/** All reports run under the caller's row-level security, so they only ever contain rows that person may see.
 *  Every export is written to the audit log. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const me = await getMe();
  if (!me || !hasRole(me, "teacher", "assistant", "school_admin", "system_admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (mfaBlocked(me)) return NextResponse.json({ error: "mfa_required" }, { status: 403 });
  const spec = COLS[kind]; const classId = req.nextUrl.searchParams.get("classId"); const format = req.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "csv";
  if (!spec || !classId || !/^[0-9a-f-]{36}$/i.test(classId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const sb = await supabaseServer();
  const { data: cls } = await sb.from("classes").select("id, name, org_id").eq("id", classId).maybeSingle();
  if (!cls) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: sessions } = await sb.from("sessions").select("id, title, starts_at").eq("class_id", classId).order("starts_at").limit(1000);
  const ids = (sessions ?? []).map((s) => s.id);
  const { data: enrols } = await sb.from("enrollments").select("id, student_id").eq("class_id", classId).eq("status", "approved").limit(5000);
  const { data: recs } = ids.length ? await sb.from("attendance_records").select("session_id, student_id, effective_status, computed_status, seconds_present, late_minutes, early_minutes, checks_sent, checks_passed, confidence").in("session_id", ids).limit(50000) : { data: [] };

  const wantIds = new Set<string>([...(enrols ?? []).map((e) => e.student_id), ...(recs ?? []).map((r) => r.student_id)]);
  const { data: plans } = await sb.from("fee_plans").select("id").eq("class_id", classId);
  const { data: pays } = plans?.length ? await sb.from("payments").select("id, payer_id, beneficiary_id, mpesa_receipt, amount, state, paid_at").in("fee_plan_id", plans.map((p) => p.id)).limit(20000) : { data: [] };
  const { data: ovr } = ids.length ? await sb.from("overrides").select("session_id, enrollment_id, status, reason, author_id, created_at").in("session_id", ids).limit(20000) : { data: [] };
  (pays ?? []).forEach((p) => { wantIds.add(p.payer_id); wantIds.add(p.beneficiary_id); }); (ovr ?? []).forEach((o) => wantIds.add(o.author_id));
  const { data: people } = wantIds.size ? await sb.from("profiles").select("id, full_name, admission_no").in("id", [...wantIds]).limit(10000) : { data: [] };
  const P = (people ?? []) as R.Person[], Rc = (recs ?? []) as R.Rec[], S = (sessions ?? []) as R.Sess[];

  let rows: Record<string, unknown>[];
  switch (kind) {
    case "attendance": rows = R.attendanceSheet(Rc, P, S); break;
    case "summary": rows = R.studentSummary(Rc, P); break;
    case "late-early": rows = R.lateEarly(Rc, P); break;
    case "overrides": rows = R.overrideReport((ovr ?? []) as R.Ovr[], P, S, new Map((enrols ?? []).map((e) => [e.id, e.student_id]))); break;
    case "payment-vs-attendance": {
      const { data: ents } = await sb.from("entitlements").select("student_id, payment_id, exemption_id, status").eq("class_id", classId).limit(10000);
      rows = R.paymentVsAttendance((enrols ?? []).map((e) => e.student_id), (ents ?? []) as R.Ent[], (pays ?? []) as R.Pay[], Rc, P); break; }
    default: { // payments: commission percentage is private, so read it with the server key and only for this school
      const { data: pct } = await admin().rpc("rpc_commission_percent", { p_org: cls.org_id });
      rows = R.paymentsRecon((pays ?? []) as R.Pay[], P, pct === null || pct === undefined ? null : Number(pct)); }
  }

  await admin().rpc("rpc_audit", { p_org: cls.org_id, p_actor: me.id, p_action: "report.exported", p_entity: "class", p_entity_id: classId, p_old: null, p_new: { report: kind, format, rows: rows.length }, p_reason: null, p_source: "user" });
  const fname = `${kind}-${cls.name.replace(/[^\w]+/g, "-").slice(0, 30)}`;
  if (format === "pdf") {
    const bytes = await tablePdf({ title: spec.title, subtitle: `${cls.name} · exported ${new Date().toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" })}`, columns: spec.cols, rows });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fname}.pdf"`, "Cache-Control": "no-store" } });
  }
  return new NextResponse(toCsv(rows, spec.cols.map(({ key, header }) => ({ key, header }))), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fname}.csv"`, "Cache-Control": "no-store" } });
}
