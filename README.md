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
| Area | Where | Status |
| --- | --- | --- |
| Schema, RLS, hash-chained audit log, `compute_attendance`, `confirm_payment` | `supabase/schemas/01-09` | Built, 4 test files pass on Postgres 16 |
| Meeting links hidden from the Data API (column privileges), single-use join tokens, device binding | `09_gateway_and_rpc.sql` | Built and tested |
| Join gateway, rotating code, heartbeat, random checks, open/close window, override, device approval | `app/api/sessions`, `app/api/devices` | Written, not run against a live stack |
| STK push, Daraja callback (secret path, intent/amount/phone match, STK query, unique receipt), reconcile job | `app/api/payments`, `app/api/daraja`, `app/api/jobs` | Written; callback logic unit-tested |
| Student dashboard (join, pay, live checks), teacher session controls with live code, school overview, audit viewer | `app/(student|teacher|school|system)` | Written, not rendered |
| PWA manifest, service worker, design tokens | `app/manifest.ts`, `public/sw.js`, `app/globals.css` | Written |

## Not built yet (MVP list in PRD section 2)
Sign-up, invitation links and approval queue; class/session/timetable creation screens; fee-plan setup screens; access-link/QR redemption page; CSV and PDF reports; email and in-app notification delivery worker (outbox); Web Push sending; Realtime Broadcast (polling works now); teacher review queue UI for claims and devices (APIs exist); MFA for admins; Playwright flows; CI; the `audit-digests` storage bucket.

## Before go-live
Apply for Safaricom go-live now. Confirm the Safaricom IP list in `lib/payments/daraja.ts`. Put the Vercel Firewall rate limits in front of sign-in, join and code entry (the in-code counters are per-instance only). Lawyer review of consent and cross-border storage (PRD section 14).
