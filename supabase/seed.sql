-- Local and CI test data for `supabase db reset` and the Playwright flows. NEVER run against production:
-- it creates accounts with a known password.
do $$
declare pw text := extensions.crypt('Passw0rd!test', extensions.gen_salt('bf'));
        u record;
begin
  for u in select * from (values
      ('10000000-0000-0000-0000-000000000001'::uuid, 'admin@eduquench.test', 'Test Admin'),
      ('10000000-0000-0000-0000-000000000002'::uuid, 'teacher@eduquench.test', 'Test Teacher'),
      ('10000000-0000-0000-0000-000000000003'::uuid, 'student1@eduquench.test', 'Student One'),
      ('10000000-0000-0000-0000-000000000004'::uuid, 'student2@eduquench.test', 'Student Two')) v(id, email, name) loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, pw, now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', now(), now(), now());
    insert into public.profiles (id, full_name, phone, email, admission_no, is_minor, guardian_name, guardian_phone)
    values (u.id, u.name, '+2547' || lpad((10000000 + (abs(hashtext(u.email)) % 89999999))::text, 8, '0'), u.email, 'ADM-' || left(u.id::text, 12), false, null, null);
  end loop;
end $$;

insert into public.organizations (id, name, slug, status) values ('b0000000-0000-0000-0000-000000000001', 'Demo Secondary School', 'demo-school', 'approved');
insert into public.memberships (user_id, org_id, role) values
  ('10000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'school_admin'),
  ('10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'teacher'),
  ('10000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'student');
insert into public.classes (id, org_id, name, meeting_provider, meeting_url, created_by) values
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Grade 9 Mathematics', 'pasted_link', 'https://meet.example.com/e2e-room', '10000000-0000-0000-0000-000000000002');
insert into public.class_staff values ('b1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'teacher');
insert into public.enrollments (org_id, class_id, student_id, status, approved_by) values
  ('b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'approved', '10000000-0000-0000-0000-000000000002');
insert into public.fee_plans (id, org_id, class_id, kind, name, amount, sessions_covered) values
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'full_course', 'Full course', 500, null);
-- A lesson that is "now": started 5 minutes ago, ends in 55 (so Join is open).
insert into public.sessions (id, org_id, class_id, title, starts_at, ends_at) values
  ('b3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Algebra live lesson', now() - interval '5 minutes', now() + interval '55 minutes');
insert into private.commission_rules (org_id, percent) values (null, 10);
