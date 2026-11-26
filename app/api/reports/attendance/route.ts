import { NextResponse, type NextRequest } from "next/server";
import { getMe, hasRole } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";
import { admin } from "@/lib/supabase/admin";
import { toCsv, minutes } from "@/lib/reports/csv";

/** Class attendance sheet as CSV. Runs under the caller's row-level security, so it only contains rows they may see.
 *  Every export is written to the audit log. */
export async function GET(req: NextRequest) {
  const me = await getMe();
  if (!me || !hasRole(me, "teacher", "assistant", "school_admin", "system_admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const classId = req.nextUrl.searchParams.get("classId");
  if (!classId || !/^[0-9a-f-]{36}$/i.test(classId)) return NextResponse.json({ error: "classId required" }, { status: 400 });
  const sb = await supabaseServer();
  const { data: sessions } = await sb.from("sessions").select("id, title, starts_at, org_id").eq("class_id", classId).order("starts_at");
  const ids = (sessions ?? []).map((s) => s.id);
  if (!ids.length) return new NextResponse(toCsv([], [{ key: "student", header: "Student" }]), { headers: { "Content-Type": "text/csv; charset=utf-8" } });
  const { data: recs } = await sb.from("attendance_records").select("session_id, student_id, computed_status, effective_status, seconds_present, late_minutes, early_minutes, checks_sent, checks_passed, confidence").in("session_id", ids);
  const { data: profs } = await sb.from("profiles").select("id, full_name, admission_no").in("id", [...new Set((recs ?? []).map((r) => r.student_id))]);
  const who = new Map((profs ?? []).map((p) => [p.id, p])); const ses = new Map((sessions ?? []).map((s) => [s.id, s]));
  const rows = (recs ?? []).map((r) => ({
    session: ses.get(r.session_id)?.title, date: ses.get(r.session_id)?.starts_at?.slice(0, 10),
    student: who.get(r.student_id)?.full_name, admission: who.get(r.student_id)?.admission_no,
    status: r.effective_status, computed: r.computed_status, minutes_present: minutes(r.seconds_present),
    late_min: r.late_minutes, early_min: r.early_minutes, checks: `${r.checks_passed}/${r.checks_sent}`, confidence: r.confidence,
  }));
  const csv = toCsv(rows, [
    { key: "date", header: "Date" }, { key: "session", header: "Session" }, { key: "student", header: "Student" }, { key: "admission", header: "Admission" },
    { key: "status", header: "Status" }, { key: "computed", header: "Computed status" }, { key: "minutes_present", header: "Minutes present" },
    { key: "late_min", header: "Late (min)" }, { key: "early_min", header: "Left early (min)" }, { key: "checks", header: "Checks passed" }, { key: "confidence", header: "Confidence" },
  ]);
  await admin().rpc("rpc_audit", { p_org: sessions![0].org_id, p_actor: me.id, p_action: "report.exported", p_entity: "class", p_entity_id: classId, p_old: null, p_new: { report: "attendance_sheet", rows: rows.length }, p_reason: null, p_source: "user" });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance-${classId.slice(0, 8)}.csv"`, "Cache-Control": "no-store" } });
}
