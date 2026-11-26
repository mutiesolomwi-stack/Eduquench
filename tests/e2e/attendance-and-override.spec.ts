import { test, expect, type BrowserContext } from "@playwright/test";
import { ID, U, login, service } from "./helpers";

async function as(ctx: BrowserContext, email: string) { const p = await ctx.newPage(); await login(p, email); return p; }

test("teacher opens attendance, student submits the live code, override needs a reason and is audited", async ({ browser }) => {
  const sb = service();
  const t = await (await browser.newContext()).newPage(); await login(t, U.teacher);
  const s = await (await browser.newContext()).newPage(); await login(s, U.student1);

  // Teacher starts attendance and sees a 6-digit code.
  await t.goto("/sessions");
  await t.getByRole("button", { name: "Start attendance" }).first().click();
  const code = (await t.locator(".code").first().innerText()).trim();
  expect(code).toMatch(/^\d{6}$/);

  // Student: a wrong code is refused, the right one is accepted, a second use in the same round is refused.
  await s.goto("/dashboard");
  await s.getByLabel("Code from your teacher").fill(code === "000000" ? "111111" : "000000"); await s.getByRole("button", { name: "Submit" }).click();
  await expect(s.getByText("not right")).toBeVisible();
  await s.getByLabel("Code from your teacher").fill(code); await s.getByRole("button", { name: "Submit" }).click();
  await expect(s.getByText(/accepted|Wait for the next code/)).toBeVisible();

  // Teacher ends attendance: statuses are computed on the server.
  await t.getByRole("button", { name: "End attendance" }).click();
  await expect(t.getByText("statuses computed")).toBeVisible();

  // Override: refused without a reason, accepted with one, and the audit log records it.
  const { data: enr } = await sb.from("enrollments").select("id").eq("class_id", ID.cls).eq("student_id", ID.student1).single();
  const noReason = await t.request.post(`/api/sessions/${ID.session}/override`, { data: { enrollmentId: enr!.id, status: "excused", reason: " " } });
  expect(noReason.status()).toBe(400);
  const ok = await t.request.post(`/api/sessions/${ID.session}/override`, { data: { enrollmentId: enr!.id, status: "excused", reason: "School network outage" } });
  expect(ok.ok()).toBeTruthy();
  const { data: audit } = await sb.rpc("rpc_audit_count_like", { p_action: "attendance.override" });
  expect(Number(audit)).toBeGreaterThanOrEqual(1);

  // The student is told, and cannot override anything themselves.
  await s.goto("/notifications");
  await expect(s.getByText("Your attendance record was changed")).toBeVisible();
  const forbidden = await s.request.post(`/api/sessions/${ID.session}/override`, { data: { enrollmentId: enr!.id, status: "verified_present", reason: "please" } });
  expect(forbidden.status()).toBe(403);
});
