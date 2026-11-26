import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { studentSummary, lateEarly, paymentVsAttendance, paymentsRecon, overrideReport, attendanceSheet, type Rec, type Person } from "../lib/reports/build.ts";
import { tablePdf, pdfSafe } from "../lib/reports/pdf.ts";

const rec = (student_id: string, status: string, extra: Partial<Rec> = {}): Rec => ({ session_id: "s1", student_id, effective_status: status, computed_status: status, seconds_present: 3000, late_minutes: 0, early_minutes: 0, checks_sent: 3, checks_passed: 3, confidence: "low", ...extra });
const people: Person[] = [{ id: "a", full_name: "Amina", admission_no: "1" }, { id: "b", full_name: "Brian", admission_no: "2" }, { id: "c", full_name: "Chebet", admission_no: "3" }];

test("student summary counts statuses and percentage (excused counts as attended)", () => {
  const rows = studentSummary([rec("a", "verified_present"), rec("a", "absent"), rec("a", "excused"), rec("a", "late")], people);
  assert.equal(rows[0].sessions, 4); assert.equal(rows[0].attended, 3); assert.equal(rows[0].attendance_pct, 75); assert.equal(rows[0].absent, 1);
});
test("late and early report totals minutes and drops students with neither", () => {
  const rows = lateEarly([rec("a", "late", { late_minutes: 25 }), rec("a", "late", { late_minutes: 30 }), rec("b", "verified_present"), rec("c", "left_early", { early_minutes: 40 })], people);
  assert.deepEqual(rows.map((r) => [r.student, r.late_minutes_total, r.early_minutes_total]), [["Amina", 55, 0], ["Chebet", 0, 40]]);
});
test("payment versus attendance flags the three cases", () => {
  const rows = paymentVsAttendance(["a", "b", "c"], [{ student_id: "c", payment_id: null, exemption_id: "x", status: "active" }],
    [{ id: "p1", payer_id: "a", beneficiary_id: "a", mpesa_receipt: "R1", amount: "500.00", state: "matched", paid_at: "2027-02-01T10:00:00Z" }], [rec("b", "verified_present"), rec("c", "verified_present")], people);
  const f = Object.fromEntries(rows.map((r) => [r.student, r.flag]));
  assert.equal(f.Amina, "Paid but never attended"); assert.equal(f.Brian, "Attended without payment or exemption"); assert.equal(f.Chebet, "");
});
test("payments reconciliation splits commission and share", () => {
  const [r] = paymentsRecon([{ id: "p", payer_id: "a", beneficiary_id: "b", mpesa_receipt: "TKA1B2C3D4", amount: "1000.00", state: "matched", paid_at: "2027-02-01T10:00:00Z" }], people, 10);
  assert.equal(r.commission_kes, 100); assert.equal(r.school_share_kes, 900); assert.equal(r.beneficiary, "Brian");
  assert.equal(paymentsRecon([{ id: "p", payer_id: "a", beneficiary_id: "b", mpesa_receipt: "X", amount: 5, state: "matched", paid_at: "2027-02-01T10:00:00Z" }], people, null)[0].commission_kes, "");
});
test("override report resolves names and orders newest first", () => {
  const rows = overrideReport([{ session_id: "s1", enrollment_id: "e1", status: "excused", reason: "outage", author_id: "b", created_at: "2027-02-02T10:00:00Z" }, { session_id: "s1", enrollment_id: "e1", status: "absent", reason: "x", author_id: "b", created_at: "2027-02-03T10:00:00Z" }],
    people, [{ id: "s1", title: "Algebra", starts_at: "2027-02-01T10:00:00Z" }], new Map([["e1", "a"]]));
  assert.equal(rows[0].new_status, "absent"); assert.equal(rows[0].student, "Amina"); assert.equal(rows[0].author, "Brian");
});
test("attendance sheet sorts by date then name", () => {
  const rows = attendanceSheet([rec("b", "absent"), rec("a", "late")], people, [{ id: "s1", title: "Algebra", starts_at: "2027-02-01T10:00:00Z" }]);
  assert.deepEqual(rows.map((r) => r.student), ["Amina", "Brian"]);
});
test("PDF paginates and survives characters the standard font cannot draw", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ n: i === 0 ? "Wanjiku Ŋ 王" : `Student ${i}`, s: "verified_present" }));
  const bytes = await tablePdf({ title: "Class attendance", subtitle: "Grade 9", columns: [{ key: "n", header: "Name", width: 3 }, { key: "s", header: "Status", width: 2 }], rows });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 3, `pages ${doc.getPageCount()}`);
  assert.equal(pdfSafe("Ŋ王a"), "??a");
});
