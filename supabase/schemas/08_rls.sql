-- Row-level security. Every public table: RLS on; policies name their role and test ownership/membership.
-- Default: nothing is granted to anon; authenticated gets SELECT where listed and writes only where a policy allows.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
revoke all on all tables in schema private from anon, authenticated;

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
  for t in select tablename from pg_tables where schemaname = 'private' loop
    execute format('alter table private.%I enable row level security', t);
  end loop;
end $$;

-- ---- organizations
grant select on public.organizations to authenticated;
create policy "members read their school" on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));
grant update (name) on public.organizations to authenticated;
create policy "school admin edits school" on public.organizations for update to authenticated
  using ((select private.has_org_role(id, array['school_admin']::public.app_role[])))
  with check ((select private.has_org_role(id, array['school_admin']::public.app_role[])));
-- Status (approval) is changed by the system admin through the server only.

-- ---- profiles: own row, plus staff/guardians within scope
grant select on public.profiles to authenticated;
grant update (full_name, phone, email) on public.profiles to authenticated;
grant insert (id, full_name, phone, email, admission_no, is_minor) on public.profiles to authenticated;
create policy "read own or scoped profiles" on public.profiles for select to authenticated using (
  id = (select auth.uid())
  or (select private.is_system_admin())
  or exists (select 1 from public.memberships mine
             join public.memberships theirs on theirs.org_id = mine.org_id and theirs.user_id = profiles.id
             where mine.user_id = (select auth.uid()) and mine.status = 'active'
               and mine.role in ('school_admin','teacher','assistant'))
  or (select private.is_guardian_of(id)));
create policy "insert own profile" on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---- memberships: read own, admins read their school; writes are server only (roles never self-assigned)
grant select on public.memberships to authenticated;
create policy "read own memberships" on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or (org_id is not null and (select private.has_org_role(org_id, array['school_admin']::public.app_role[]))));

-- ---- guardian links, consents
grant select on public.guardian_links to authenticated;
create policy "guardian links visible to parties and admins" on public.guardian_links for select to authenticated
  using (guardian_id = (select auth.uid()) or student_id = (select auth.uid())
         or (select private.has_org_role(org_id, array['school_admin']::public.app_role[])));
grant select on public.consents to authenticated;
create policy "own consents or school admin" on public.consents for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_org_role(org_id, array['school_admin']::public.app_role[])));

-- ---- academic structure: members read, school admin writes; teachers write within own classes
do $$ declare t text; begin
  foreach t in array array['academic_periods','programs','holidays'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy "members read" on public.%I for select to authenticated using ((select private.is_org_member(org_id)))$p$, t);
    execute format($p$create policy "admin insert" on public.%I for insert to authenticated with check ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])))$p$, t);
    execute format($p$create policy "admin update" on public.%I for update to authenticated using ((select private.has_org_role(org_id, array['school_admin']::public.app_role[]))) with check ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])))$p$, t);
    execute format($p$create policy "admin delete" on public.%I for delete to authenticated using ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])))$p$, t);
  end loop;
end $$;

grant select, insert, update, delete on public.classes to authenticated;
create policy "class members read" on public.classes for select to authenticated
  using ((select private.is_class_member(id)));
create policy "admin or teacher create class" on public.classes for insert to authenticated
  with check ((select private.has_org_role(org_id, array['school_admin','teacher']::public.app_role[])));
create policy "class staff update" on public.classes for update to authenticated
  using ((select private.is_class_staff(id))) with check ((select private.has_org_role(org_id, array['school_admin','teacher']::public.app_role[])));
create policy "admin delete class" on public.classes for delete to authenticated
  using ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])));

grant select, insert, update, delete on public.class_staff to authenticated;
create policy "members read staff" on public.class_staff for select to authenticated
  using ((select private.is_class_member(class_id)));
create policy "admin assigns staff" on public.class_staff for insert to authenticated
  with check ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])));
create policy "admin updates staff" on public.class_staff for update to authenticated
  using ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])))
  with check ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])));
create policy "admin removes staff" on public.class_staff for delete to authenticated
  using ((select private.has_org_role(org_id, array['school_admin']::public.app_role[])));

grant select, insert, update, delete on public.timetables, public.sessions, public.fee_plans to authenticated;
do $$ declare t text; begin
  foreach t in array array['timetables','sessions','fee_plans'] loop
    execute format($p$create policy "class members read" on public.%I for select to authenticated using ((select private.is_class_member(class_id)))$p$, t);
    execute format($p$create policy "staff insert" on public.%I for insert to authenticated with check ((select private.is_class_staff(class_id)) and (select private.has_org_role(org_id, array['school_admin','teacher']::public.app_role[])))$p$, t);
    execute format($p$create policy "staff update" on public.%I for update to authenticated using ((select private.is_class_staff(class_id))) with check ((select private.is_class_staff(class_id)) and (select private.has_org_role(org_id, array['school_admin','teacher']::public.app_role[])))$p$, t);
    execute format($p$create policy "staff delete" on public.%I for delete to authenticated using ((select private.is_class_staff(class_id)))$p$, t);
  end loop;
end $$;
-- Students must not rewrite session status/rules; the staff-only policies above already cover that.

-- ---- enrollments: students request, staff approve; entitlement fields are server-only (separate table)
grant select, insert, update on public.enrollments to authenticated;
create policy "read own or class staff" on public.enrollments for select to authenticated
  using (student_id = (select auth.uid()) or (select private.is_class_staff(class_id)) or (select private.is_guardian_of(student_id)));
create policy "student requests enrolment" on public.enrollments for insert to authenticated
  with check (student_id = (select auth.uid()) and status = 'requested'
              and exists (select 1 from public.classes c where c.id = class_id and c.org_id = enrollments.org_id)
              and (select private.is_org_member(org_id)));
create policy "staff approve enrolment" on public.enrollments for update to authenticated
  using ((select private.is_class_staff(class_id)))
  with check ((select private.is_class_staff(class_id)) and org_id = (select c.org_id from public.classes c where c.id = class_id));
revoke update on public.enrollments from authenticated;
grant update (status, approved_by) on public.enrollments to authenticated;

-- ---- payments, entitlements, exemptions: read-only for clients (all writes via server)
grant select on public.payments, public.entitlements, public.exemptions to authenticated;
create policy "payer, beneficiary or school admin read payments" on public.payments for select to authenticated
  using (payer_id = (select auth.uid()) or beneficiary_id = (select auth.uid())
         or (select private.has_org_role(org_id, array['school_admin']::public.app_role[]))
         or (select private.is_guardian_of(beneficiary_id)));
create policy "own or scoped entitlements" on public.entitlements for select to authenticated
  using (student_id = (select auth.uid()) or (select private.is_class_staff(class_id)) or (select private.is_guardian_of(student_id)));
create policy "own or scoped exemptions" on public.exemptions for select to authenticated
  using (student_id = (select auth.uid()) or (select private.is_class_staff(class_id)));

-- ---- attendance: students read own, staff read within scope; NO client writes of any kind
grant select on public.attendance_records, public.attendance_events, public.attendance_windows,
  public.challenges, public.connection_claims, public.overrides, public.platform_participants to authenticated;
create policy "own or class staff or guardian" on public.attendance_records for select to authenticated
  using (student_id = (select auth.uid()) or exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_staff(s.class_id)))
         or (select private.is_guardian_of(student_id)));
create policy "own or class staff" on public.attendance_events for select to authenticated
  using (student_id = (select auth.uid()) or exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_staff(s.class_id))));
create policy "class members read window" on public.attendance_windows for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_member(s.class_id))));
create policy "own or staff challenges" on public.challenges for select to authenticated
  using (exists (select 1 from public.enrollments e where e.id = enrollment_id and e.student_id = (select auth.uid()))
         or exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_staff(s.class_id))));
create policy "own or staff claims" on public.connection_claims for select to authenticated
  using (student_id = (select auth.uid()) or exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_staff(s.class_id))));
create policy "own or staff overrides" on public.overrides for select to authenticated
  using (exists (select 1 from public.enrollments e where e.id = enrollment_id and e.student_id = (select auth.uid()))
         or exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_staff(s.class_id))));
create policy "staff read platform data" on public.platform_participants for select to authenticated
  using (exists (select 1 from public.sessions s where s.id = session_id and (select private.is_class_staff(s.class_id))));

-- ---- audit view, data requests, notifications
grant select on public.audit_log_view to authenticated;
grant select, insert on public.data_requests to authenticated;
create policy "own requests or school admin" on public.data_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_org_role(org_id, array['school_admin']::public.app_role[])));
create policy "create own request" on public.data_requests for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open');

grant select, update (read_at) on public.notifications to authenticated;
create policy "own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own read" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, update on public.notification_prefs to authenticated;
create policy "own prefs read" on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy "own prefs insert" on public.notification_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own prefs update" on public.notification_prefs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, insert, delete on public.push_subscriptions to authenticated;
create policy "own push read" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "own push insert" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "own push delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

-- Private tables: RLS on, no policies, no grants -> only service_role (bypasses RLS) can reach them.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant usage, select on all sequences in schema public to service_role;
grant usage, select on all sequences in schema private to service_role;
revoke update, delete, truncate on private.audit_log from service_role;
revoke update, delete, truncate on private.ledger_entries from service_role;
revoke update, delete, truncate on public.attendance_events from service_role;
