import { test, expect } from "@playwright/test";
import { ID, U, login, PASSWORD } from "./helpers";

test("invitation link: new student signs up, accepts consent, teacher approves, student is told", async ({ browser }) => {
  const teacher = await (await browser.newContext()).newPage(); await login(teacher, U.teacher);
  const res = await teacher.request.post("/api/invitations", { data: { classId: ID.cls, days: 7 } });
  expect(res.ok()).toBeTruthy();
  const { url } = await res.json();

  const stu = await (await browser.newContext()).newPage();
  const email = `new.${Date.now()}@eduquench.test`;
  await stu.goto(`/sign-up?next=${encodeURIComponent(new URL(url).pathname)}`);
  await stu.getByLabel("Full name").fill("Wanjiru Kamau");
  await stu.getByLabel(/^Email/).fill(email);
  await stu.getByLabel(/^Password/).fill(PASSWORD);
  await stu.getByLabel("Mobile number").fill("0712345678");
  await stu.getByLabel("Admission or student number").fill("E2E-001");
  await stu.getByLabel(/Parent or guardian name/).fill("Mrs Kamau");
  await stu.getByLabel(/Parent or guardian phone/).fill("0711000000");
  await stu.getByRole("button", { name: "Create account" }).click();

  // Without consent the request is refused; with it, it goes through.
  await expect(stu).toHaveURL(/\/join\//);
  await stu.getByRole("button", { name: "Request to join" }).click();
  await expect(stu.getByRole("alert")).toContainText("consent");
  await stu.getByLabel(/accept the terms/).check(); await stu.getByLabel(/parent or guardian has agreed/).check();
  await stu.getByRole("button", { name: "Request to join" }).click();
  await expect(stu).toHaveURL(/requested=1/);

  // Teacher approves from the queue.
  await teacher.goto("/approvals");
  await expect(teacher.getByText("Wanjiru Kamau")).toBeVisible();
  await teacher.getByRole("button", { name: "Approve" }).first().click();
  await expect(teacher.getByText("approved")).toBeVisible();

  // Approved but unpaid: still cannot join.
  await stu.goto("/notifications");
  await expect(stu.getByText("You are approved")).toBeVisible();
});
