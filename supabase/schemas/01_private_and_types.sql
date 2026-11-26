-- Eduquench: foundation. Private schema is NOT exposed through the Data API.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum
  ('system_admin','school_admin','teacher','assistant','student','parent');
create type public.org_status as enum ('pending','approved','suspended');
create type public.member_status as enum ('active','invited','suspended');
create type public.enrollment_status as enum ('requested','approved','removed');
create type public.session_status as enum ('scheduled','live','ended','cancelled');
create type public.attendance_status as enum
  ('verified_present','late','left_early','partial','pending_review','excused','absent','overridden');
create type public.event_type as enum
  ('join','leave','heartbeat','code_submitted','challenge_sent','challenge_answered',
   'challenge_missed','device_change_requested','platform_join','platform_leave',
   'claim_submitted','override_applied');
create type public.entitlement_status as enum ('active','expired','revoked');
create type public.challenge_type as enum ('tap','question','selfie');
create type public.claim_status as enum ('pending','approved','rejected');
create type public.confidence_level as enum ('high','medium','low');
