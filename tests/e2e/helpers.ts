import { createClient } from "@supabase/supabase-js";
import { expect, type Page } from "@playwright/test";

export const PASSWORD = "Passw0rd!test";
export const U = { admin: "admin@eduquench.test", teacher: "teacher@eduquench.test", student1: "student1@eduquench.test", student2: "student2@eduquench.test" };
export const ID = { student1: "10000000-0000-0000-0000-000000000003", teacher: "10000000-0000-0000-0000-000000000002", cls: "b1000000-0000-0000-0000-000000000001",
  session: "b3000000-0000-0000-0000-000000000001", plan: "b2000000-0000-0000-0000-000000000001" };

export const service = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export async function login(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
