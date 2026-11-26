-- ---------- audit log ----------
select private.write_audit('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','test.one','thing','1',null,'{"a":1}','r');
select private.write_audit('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','test.two','thing','2','{"a":1}','{"a":2}','r');
select t.ok(private.verify_audit_chain() is null, 'audit chain verifies');
do $$ begin
  begin update private.audit_log set reason = 'x' where id = 1; raise exception 'FAIL: update allowed';
  exception when insufficient_privilege then raise notice 'ok  - audit update rejected (trigger)'; end;
  begin delete from private.audit_log; raise exception 'FAIL: delete allowed';
  exception when insufficient_privilege then raise notice 'ok  - audit delete rejected (trigger)'; end;
  begin truncate private.audit_log; raise exception 'FAIL: truncate allowed';
  exception when insufficient_privilege then raise notice 'ok  - audit truncate rejected (trigger)'; end;
  set local role service_role;
  begin update private.audit_log set reason = 'x'; raise exception 'FAIL: service_role update allowed';
  exception when insufficient_privilege then raise notice 'ok  - service_role cannot update audit'; end;
  reset role;
end $$;
-- tampering by a superuser (bypassing triggers) must break the chain
alter table private.audit_log disable trigger audit_log_no_change;
update private.audit_log set new_value = '{"a":99}' where id = 2;
alter table private.audit_log enable trigger audit_log_no_change;
select t.ok(private.verify_audit_chain() = 2, 'tampering with a row is detected at that row');
alter table private.audit_log disable trigger audit_log_no_change;
update private.audit_log set new_value = '{"a":2}' where id = 2;
alter table private.audit_log enable trigger audit_log_no_change;
select t.ok(private.verify_audit_chain() is null, 'chain intact after restoring (test cleanup)');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000002','select 1 from public.audit_log_view') >= 2, 'school admin reads own school audit');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000007','select 1 from public.audit_log_view') = 0, 'other school admin sees none');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000003','select 1 from public.audit_log_view') = 0, 'teacher cannot read audit log');

-- append-only evidence
insert into public.attendance_events (org_id, session_id, enrollment_id, student_id, type)
values ('a0000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000009','join');
do $$ begin
  begin update public.attendance_events set type = 'leave'; raise exception 'FAIL: event update allowed';
  exception when insufficient_privilege then raise notice 'ok  - attendance events are append-only'; end;
end $$;
delete from public.attendance_records where false;

-- ---------- payments ----------
insert into private.commission_rules (org_id, percent) values (null, 10);
insert into public.fee_plans (id, org_id, class_id, kind, name, amount, sessions_covered)
values ('f0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','full_course','Term fee', 1000, null);
insert into private.payment_intents (id, org_id, payer_id, beneficiary_id, fee_plan_id, phone, amount, checkout_request_id)
values ('b0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000009','f0000000-0000-0000-0000-000000000001','254700000001',1000,'ws_CO_1');
-- before payment: student 9 is enrolled but has no entitlement
insert into public.sessions (id, org_id, class_id, title, starts_at, ends_at, status)
values ('50000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Live now', now()-interval '5 minutes', now()+interval '55 minutes','live');
select t.ok(private.check_join('00000000-0000-0000-0000-000000000009','50000000-0000-0000-0000-000000000003') = 'no_entitlement', 'enrolled but unpaid student is refused');
select t.ok(private.check_join('00000000-0000-0000-0000-000000000008','50000000-0000-0000-0000-000000000003') = 'not_enrolled', 'student from another school is refused');
do $$ begin
  begin perform private.confirm_payment('b0000000-0000-0000-0000-000000000001','QWE1', 900,'254700000001','\x01','\x02');
        raise exception 'FAIL: wrong amount accepted';
  exception when sqlstate '22023' then raise notice 'ok  - wrong amount rejected'; end;
end $$;
select t.ok(private.confirm_payment('b0000000-0000-0000-0000-000000000001','QWE1', 1000,'254700000001','\x0a0a','\x0b0b') is not null, 'confirmed payment returns entitlement');
select t.ok(private.confirm_payment('b0000000-0000-0000-0000-000000000001','QWE1', 1000,'254700000001','\x0c0c','\x0d0d') is null, 'replayed callback does nothing');
select t.ok((select count(*) from public.payments where mpesa_receipt = 'QWE1') = 1, 'one payment per receipt');
select t.ok((select count(*) from public.entitlements where payment_id is not null) = 1, 'one entitlement per payment');
select t.ok((select sum(amount) from private.ledger_entries where kind in ('commission','school_share')) = 1000
        and (select amount from private.ledger_entries where kind = 'commission') = 100, 'ledger: commission 100 + school 900 = 1000');
select t.ok(private.check_join('00000000-0000-0000-0000-000000000009','50000000-0000-0000-0000-000000000003') = 'ok', 'beneficiary may join after payment');
select t.ok(private.check_join('00000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000003') = 'not_enrolled', 'payer is not granted access (beneficiary only)');
select t.ok((select count(*) from private.audit_log where action = 'payment.confirmed') = 1, 'payment audited');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000009','select 1 from public.payments') = 1, 'beneficiary sees own payment');
select t.ok(t.count_as('00000000-0000-0000-0000-000000000005','select 1 from public.payments') = 0, 'other student cannot see payment');
select t.ok(private.verify_audit_chain() is null, 'audit chain still intact');
