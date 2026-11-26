create schema t;
grant usage on schema t to public;
create function t.ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL: %', msg; end if; raise notice 'ok  - %', msg; end $$;
-- run sql as a role/user; expects an error OR zero rows affected (RLS filtered)
create function t.blocked(p_uid uuid, p_sql text, msg text) returns void language plpgsql as $$
declare n int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  execute 'set local role authenticated';
  begin execute p_sql; get diagnostics n = row_count;
    execute 'reset role';
    if n > 0 then raise exception 'FAIL (allowed, % rows): %', n, msg; end if;
  exception when others then
    execute 'reset role';
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'ok  - blocked: %', msg;
end $$;
create function t.count_as(p_uid uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text,''), true);
  execute 'set local role authenticated';
  execute 'select count(*) from (' || p_sql || ') q' into n;
  execute 'reset role';
  return n;
end $$;
grant execute on all functions in schema t to public;

-- ---------- fixtures (superuser) ----------
do $$ declare i int; begin
  for i in 1..12 loop
    insert into auth.users (id, email) values (('00000000-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid, 'u'||i||'@x.test');
    insert into public.profiles (id, full_name) values (('00000000-0000-0000-0000-0000000000' || lpad(i::text,2,'0'))::uuid, 'User '||i);
  end loop;
end $$;
-- 01 sysadmin, 02 admin1, 03 teacher1, 04 student A, 05 student B, 06 parent of A, 07 org2 admin, 08 org2 student,
-- 09..12 extra students for attendance scenarios
insert into public.organizations (id, name, slug, status) values
 ('a0000000-0000-0000-0000-000000000001','School One','school-one','approved'),
 ('a0000000-0000-0000-0000-000000000002','School Two','school-two','approved');
insert into public.memberships (user_id, org_id, role) values
 ('00000000-0000-0000-0000-000000000001', null, 'system_admin'),
 ('00000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','school_admin'),
 ('00000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','teacher'),
 ('00000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','student'),
 ('00000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','student'),
 ('00000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001','parent'),
 ('00000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000002','school_admin'),
 ('00000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000002','student');
insert into public.guardian_links (org_id, guardian_id, student_id, confirmed_by, confirmed_at) values
 ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000002', now());
insert into public.classes (id, org_id, name) values
 ('c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Grade 9 Maths'),
 ('c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','Form 2 Physics');
insert into public.class_staff values ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','teacher');
insert into public.enrollments (id, org_id, class_id, student_id, status)
select ('e0000000-0000-0000-0000-0000000000' || lpad(u::text,2,'0'))::uuid, 'a0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001', ('00000000-0000-0000-0000-0000000000' || lpad(u::text,2,'0'))::uuid, 'approved'
from unnest(array[4,5,9,10,11,12]) u;
insert into public.enrollments (id, org_id, class_id, student_id, status) values
 ('e0000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008','approved');
-- an ended session (2h ago .. 1h ago) in school one, and one in school two
insert into public.sessions (id, org_id, class_id, title, starts_at, ends_at, status) values
 ('50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Algebra', now()-interval '2 hours', now()-interval '1 hour','ended'),
 ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','Optics', now()-interval '2 hours', now()-interval '1 hour','ended');
insert into public.attendance_records (org_id, session_id, enrollment_id, student_id, computed_status, effective_status)
values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','verified_present','verified_present'),
       ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000005','absent','absent'),
       ('a0000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000008','verified_present','verified_present');

-- ---------- policy tests ----------
select t.ok(t.count_as('00000000-0000-0000-0000-000000000004','select 1 from public.attendance_records') = 1, 'student A sees only own attendance record');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000005','select 1 from public.attendance_records where student_id <> ''00000000-0000-0000-0000-000000000005''') = 0, 'student B cannot see A''s record');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000003','select 1 from public.attendance_records') = 2, 'teacher sees both records of own class, not school two');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000007','select 1 from public.attendance_records') = 1, 'school two admin sees only school two');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000006','select 1 from public.attendance_records') = 1, 'confirmed guardian sees own child');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000008','select 1 from public.classes') = 1, 'student in school two cannot see school one classes');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000001','select 1 from public.attendance_records') = 3, 'system admin sees all');
select t.ok(t.count_as(null,'select 1 from public.attendance_records') = 0, 'anonymous (no uid) sees nothing');

select t.blocked('00000000-0000-0000-0000-000000000004',
  $$insert into public.attendance_events (org_id, session_id, enrollment_id, student_id, type) values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','join')$$, 'student cannot write attendance events');
select t.blocked('00000000-0000-0000-0000-000000000005',
  $$update public.attendance_records set effective_status = 'verified_present' where student_id = '00000000-0000-0000-0000-000000000005'$$, 'student cannot edit own attendance status');
select t.blocked('00000000-0000-0000-0000-000000000003',
  $$update public.attendance_records set effective_status = 'verified_present'$$, 'teacher cannot edit records directly (override path only)');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$insert into public.memberships (user_id, org_id, role) values ('00000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000001','school_admin')$$, 'student cannot grant self a role');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$insert into public.enrollments (org_id, class_id, student_id, status) values ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','approved')$$, 'student cannot self-approve enrolment');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$insert into public.payments (org_id, payer_id, beneficiary_id, mpesa_receipt, amount) values ('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','FAKE123',100)$$, 'student cannot create a payment');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$insert into public.entitlements (org_id, class_id, student_id, exemption_id) values ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004', gen_random_uuid())$$, 'student cannot create an entitlement');
select t.blocked('00000000-0000-0000-0000-000000000003',
  $$update public.sessions set org_id = 'a0000000-0000-0000-0000-000000000002'$$, 'teacher cannot move a session to another school (with check)');
select t.blocked('00000000-0000-0000-0000-000000000007',
  $$update public.classes set name = 'hacked' where id = 'c0000000-0000-0000-0000-000000000001'$$, 'other school admin cannot edit class');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$select * from private.audit_log$$ , 'client cannot read private audit table');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$select * from private.access_credentials$$ , 'client cannot read credentials');
select t.blocked('00000000-0000-0000-0000-000000000004',
  $$select private.write_audit(null,null,'x','y',null,null,null)$$ , 'client cannot call audit writer');

-- student may request enrolment, only as self and only 'requested'
select t.ok((select count(*) from (select 1) q) = 1, 'sanity');
do $$ begin
  perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000008', true);
  set local role authenticated;
  begin
    insert into public.enrollments (org_id, class_id, student_id, status)
      values ('a0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000008','requested');
  exception when unique_violation then null; end;   -- already enrolled: proves policy passed
  reset role;
  raise notice 'ok  - student can request enrolment in own school';
end $$;
