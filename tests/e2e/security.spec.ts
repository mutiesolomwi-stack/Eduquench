import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ID, U, PASSWORD, login } from "./helpers";

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/dashboard"); await expect(page).toHaveURL(/sign-in/);
  await page.goto("/audit"); await expect(page).toHaveURL(/sign-in/);
});

test("a student cannot read the meeting link or the live code through any door", async ({ page }) => {
  await login(page, U.student1);
  expect((await page.request.get(`/api/sessions/${ID.session}/code`)).status()).toBe(403);
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  await sb.auth.signInWithPassword({ email: U.student1, password: PASSWORD });
  const { error } = await sb.from("sessions").select("meeting_url").eq("id", ID.session);
  expect(error).not.toBeNull(); // column privilege: permission denied
  const { error: e2 } = await sb.from("attendance_events").insert({ org_id: "b0000000-0000-0000-0000-000000000001", session_id: ID.session, enrollment_id: ID.cls, student_id: ID.student1, type: "join" });
  expect(e2).not.toBeNull(); // students cannot write evidence
});

test("an admin without a second factor is held at the MFA page", async ({ page }) => {
  await login(page, U.admin);
  await page.goto("/overview"); await expect(page).toHaveURL(/security\/mfa/);
  await page.goto("/audit"); await expect(page).toHaveURL(/security\/mfa/);
  expect((await page.request.post("/api/exemptions", { data: { classId: ID.cls, studentId: ID.student1, reason: "bursary", kind: "scholarship", days: 30 } })).status()).toBe(403);
});
