# Eduquench (MVP build)

Next.js 16 (App Router) + Supabase + Daraja. Build plan: week 1 trust layer, week 2 payments, week 3 attendance, week 4 polish.

## Run it
```bash
npm install
cp .env.example .env.local      # fill in Supabase and Daraja sandbox values
supabase start && supabase db reset   # applies supabase/schemas/*.sql in order
npm run dev
```
Tests: `npm test` (logic, no network) and `npm run test:db` (spins up a throwaway Postgres, applies the schema, runs policy tests).

## What exists
| Area | Where | Verified how |
| --- | --- | --- |
| Schema, row-level security, hash-chained audit log, `compute_attendance`, `confirm_payment` | `supabase/schemas/01-09` | Postgres 16 tests (`npm run test:db`) |
| Meeting links hidden from the Data API, single-use join tokens, device binding and approval | `09_gateway_and_rpc.sql` | Postgres tests |
| Invitations, join-request approval, free-access grants (reason required; late payment system-admin only) | `10_onboarding.sql` | Postgres tests |
| Sign-up profile rules, guardian consent at enrolment, notification outbox with retries, connection-problem claims, access-link and code redemption, class / fee plan / holiday / timetable setup (skips holidays, EAT, idempotent), session cancel | `11_mvp_additions.sql` | Postgres tests (50+ checks) |
| Rotating code, challenge planner, Daraja callback checks, credentials, outbox retry rules, CSV, six report builders, PDF, admin-MFA rule | `lib/` | `npm test` (41 tests, no network) |
| Join gateway, code, heartbeat, checks, window open/close, override, devices, claims, invitations, exemptions, STK push and callback, reports (CSV and PDF), push subscribe, jobs | `app/api/` | Written; exercised by the Playwright specs, **not yet run** |
| Pages: sign-up, sign-in, join link with consent, student dashboard (join, pay, live code and checks, claims, push set-up), notifications, access link + QR, access code, classes, class setup (fees, timetable, join link, reports), approvals, reviews (claims and devices), reports, school overview, audit viewer, admin MFA | `app/` | Written, **not yet rendered** |
| End-to-end flows: payment and join, attendance and override, onboarding, security | `tests/e2e/`, `supabase/seed.sql` | Seed validated on Postgres; specs syntax-checked, **not yet run** |

## Run the browser tests
```bash
supabase start && supabase db reset      # loads supabase/seed.sql (test accounts, password Passw0rd!test)
npx playwright install chromium
npm run e2e
```
Set `DARAJA_CALLBACK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and the public Supabase variables in `.env.local` first. The flows never call Daraja: they post the callback themselves.

## Still not built
Phone number one-time-code verification (needs the SMS provider decision, PRD question 6); the pasted M-Pesa SMS lookup screen (the parsing helper exists); student-facing device-change request screen (a new browser is registered as pending automatically and shows in the teacher's Reviews); bulk CSV student upload; Google Meet link creation through the teacher's account (links are pasted); Realtime Broadcast (polling every 10 s works now); parent portal, chat, certificates, refunds, SMS and WhatsApp, Excel export and analytics are Phase 2 by design.

## Known trade-offs
- The access code and link appear in the beneficiary's own notification and email so they can be used; the database stores only their hashes. Joining still needs the student's own login and registered device.
- Per-student rate-limit counters are per server instance. Put Vercel Firewall rules in front of sign-in, join, code entry and payment endpoints.
- Dependencies `qrcode`, `web-push`, `pdf-lib` and `@playwright/test` were added to `package.json`; only `pdf-lib` was exercised here.

## Before go-live
Apply for Safaricom go-live now. Confirm the Safaricom IP list in `lib/payments/daraja.ts`. Put the Vercel Firewall rate limits in front of sign-in, join and code entry (the in-code counters are per-instance only). Lawyer review of consent and cross-border storage (PRD section 14).
