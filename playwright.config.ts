import { defineConfig, devices } from "@playwright/test";

/** Flows run against a local stack: `supabase start && supabase db reset` (loads supabase/seed.sql), then `npm run e2e`.
 *  One worker: the flows share one seeded database. Daraja is never called: the payment flow posts a callback itself. */
export default defineConfig({
  testDir: "tests/e2e", workers: 1, retries: process.env.CI ? 1 : 0, timeout: 60_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "mobile", use: { ...devices["Pixel 7"] } }, { name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
