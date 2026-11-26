-- Session 50..01 ran from T-2h to T-1h (60 min). Evidence helper: minutes after start.
create function t.ev(p_enr text, p_type public.event_type, p_min numeric) returns void language sql as $$
  insert into public.attendance_events (org_id, session_id, enrollment_id, student_id, type, occurred_at)
  select 'a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001', e.id, e.student_id, p_type,
         (select starts_at from public.sessions where id='50000000-0000-0000-0000-000000000001') + make_interval(secs => p_min*60)
  from public.enrollments e where e.id = ('e0000000-0000-0000-0000-0000000000'||p_enr)::uuid $$;
create function t.chk(p_enr text, p_passed boolean) returns void language sql as $$
  insert into public.challenges (org_id, session_id, enrollment_id, due_at, expires_at, sent_at, answered_at, passed)
  values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',('e0000000-0000-0000-0000-0000000000'||p_enr)::uuid,
          now()-interval '90 minutes', now()-interval '89 minutes', now()-interval '90 minutes', case when p_passed then now() end, p_passed) $$;
create function t.st(p_enr text) returns public.attendance_status language sql as $$
  select computed_status from private.compute_attendance('50000000-0000-0000-0000-000000000001', ('e0000000-0000-0000-0000-0000000000'||p_enr)::uuid) $$;

-- enrolment 04 already has records from the policy fixtures; wipe events for a clean slate
-- 10: joins at 2 min, heartbeat every 5 min to the end, passes 3/3 checks -> verified_present
select t.ev('10','join',2);
select t.ev('10','heartbeat', m) from generate_series(7,57,5) m;
select t.chk('10', true) from generate_series(1,3);
select t.ok(t.st('10') = 'verified_present', 'full presence + all checks = verified present');
select t.ok((select confidence from public.attendance_records where enrollment_id = 'e0000000-0000-0000-0000-000000000010') = 'low', 'no platform data = low confidence');
-- 11: joins 30 min in -> late
select t.ev('11','join',30); select t.ev('11','heartbeat', m) from generate_series(35,55,5) m;
select t.ok(t.st('11') = 'late', 'joined 30 min after start = late');
-- 12: joins, leaves at 15 min -> left early
select t.ev('12','join',1); select t.ev('12','heartbeat',6); select t.ev('12','heartbeat',11); select t.ev('12','leave',15);
select t.ok(t.st('12') = 'left_early', 'left 45 min before end = left early');
-- 05 had no evidence but a pre-existing record -> absent
select t.ok(t.st('05') = 'absent', 'no evidence = absent');
-- 09: gaps beyond grace are not counted -> partial
select t.ev('09','join',0); select t.ev('09','heartbeat',5); select t.ev('09','heartbeat',45); select t.ev('09','heartbeat',50);
select t.ok(t.st('09') = 'partial', 'a 40-minute gap breaks presence -> partial');
select t.ok((select seconds_present from public.attendance_records where enrollment_id = 'e0000000-0000-0000-0000-000000000009') < 60*60*0.75, 'gap time excluded from presence');
-- verified student missing checks -> partial
select t.ev('04','join',1); select t.ev('04','heartbeat', m) from generate_series(6,56,5) m;
select t.chk('04', true); select t.chk('04', false); select t.chk('04', false);
select t.ok(t.st('04') = 'partial', 'present all session but failed checks = partial');
-- pending claim -> pending review
insert into public.connection_claims (org_id, session_id, enrollment_id, student_id, note)
values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000004','my data bundle ran out');
select t.ok(t.st('04') = 'pending_review', 'open connection claim = pending review');

-- determinism: recomputing gives the same answer
select t.ok(t.st('10') = t.st('10'), 'compute is deterministic');

-- ---------- overrides ----------
do $$ begin
  begin perform private.apply_override('00000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','excused','');
        raise exception 'FAIL: override without reason accepted';
  exception when sqlstate '22023' then raise notice 'ok  - override without reason rejected'; end;
  begin perform private.apply_override('00000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','verified_present','I was there');
        raise exception 'FAIL: student override accepted';
  exception when sqlstate '42501' then raise notice 'ok  - student cannot override'; end;
  begin perform private.apply_override('00000000-0000-0000-0000-000000000007','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','excused','other school');
        raise exception 'FAIL: other-school admin override accepted';
  exception when sqlstate '42501' then raise notice 'ok  - other school admin cannot override'; end;
end $$;
select private.apply_override('00000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000004','excused','Teacher confirmed data outage');
select t.ok((select effective_status from public.attendance_records where enrollment_id = 'e0000000-0000-0000-0000-000000000004') = 'excused', 'override sets effective status');
select t.ok((select computed_status from public.attendance_records where enrollment_id = 'e0000000-0000-0000-0000-000000000004') = 'pending_review', 'computed value is always kept');
select t.ok(t.st('04') = 'pending_review' and (select effective_status from public.attendance_records where enrollment_id = 'e0000000-0000-0000-0000-000000000004') = 'excused', 'recompute keeps override layered on top');
select t.ok((select count(*) from private.audit_log where action = 'attendance.override' and reason like 'Teacher confirmed%') = 1, 'override audited with reason');
select t.ok(private.verify_audit_chain() is null, 'audit chain intact at end');
