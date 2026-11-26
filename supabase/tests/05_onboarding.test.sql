do $$
declare cls uuid := 'c0000000-0000-0000-0000-000000000001';
  admin1 uuid := '00000000-0000-0000-0000-000000000002'; teacher uuid := '00000000-0000-0000-0000-000000000003';
  stud uuid := '00000000-0000-0000-0000-000000000004'; newbie uuid := '00000000-0000-0000-0000-000000000006'; sysadmin uuid := '00000000-0000-0000-0000-000000000001';
  other_admin uuid := '00000000-0000-0000-0000-000000000007';
  h bytea := extensions.digest('invite-1', 'sha256'); enr uuid; ok boolean; n int;
begin
  -- invitations: only class authority can create one
  ok := false; begin perform public.rpc_create_invitation(stud, cls, h, 7); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot create an invitation');
  ok := false; begin perform public.rpc_create_invitation(other_admin, cls, h, 7); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'another school''s admin cannot create an invitation');
  perform public.rpc_create_invitation(teacher, cls, h, 7);
  perform t.ok(true, 'class teacher creates an invitation');

  -- redeem: creates a REQUEST only, never an approved enrolment
  enr := public.rpc_redeem_invitation(newbie, h);
  perform t.ok(enr is not null, 'valid link creates an enrolment request');
  perform t.ok((select status from public.enrollments where id = enr) = 'requested', 'request starts unapproved');
  perform t.ok(public.rpc_redeem_invitation(newbie, extensions.digest('nope', 'sha256')) is null, 'unknown link rejected');
  update private.invitations set expires_at = now() - interval '1 minute' where token_hash = h;
  perform t.ok(public.rpc_redeem_invitation('00000000-0000-0000-0000-000000000009', h) is null, 'expired link rejected');

  -- an unapproved student still cannot join
  perform t.ok(public.rpc_check_join(newbie, '50000000-0000-0000-0000-000000000001') = 'not_enrolled', 'requested student cannot join');

  -- approval queue and authority
  select count(*) into n from public.rpc_pending_enrollments(teacher);
  perform t.ok(n = 1, 'teacher sees the pending request');
  select count(*) into n from public.rpc_pending_enrollments(other_admin);
  perform t.ok(n = 0, 'other school''s admin sees nothing');
  ok := false; begin perform public.rpc_decide_enrollment(stud, enr, true); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot approve an enrolment');
  perform public.rpc_decide_enrollment(teacher, enr, true);
  perform t.ok((select status from public.enrollments where id = enr) = 'approved', 'teacher approves');

  -- still no access until paid or exempt
  perform t.ok(public.rpc_check_join(newbie, '50000000-0000-0000-0000-000000000001') = 'no_entitlement', 'approved but unpaid cannot join');

  -- exemptions: reason, authority, late payment is system admin only
  ok := false; begin perform public.rpc_grant_exemption(teacher, cls, newbie, 'scholarship', 'bursary', 30); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'teacher cannot grant free access directly');
  ok := false; begin perform public.rpc_grant_exemption(admin1, cls, newbie, 'scholarship', '  ', 30); exception when invalid_parameter_value then ok := true; end;
  perform t.ok(ok, 'free access needs a reason');
  ok := false; begin perform public.rpc_grant_exemption(admin1, cls, newbie, 'late_payment', 'paid late', 7); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'school admin cannot approve late payment');
  perform public.rpc_grant_exemption(sysadmin, cls, newbie, 'late_payment', 'paid late, confirmed with bursar', 7);
  perform public.rpc_grant_exemption(admin1, cls, stud, 'scholarship', 'bursary award 2027', null);
  perform t.ok(exists (select 1 from public.entitlements e where e.student_id = newbie and e.exemption_id is not null), 'system admin grants late-payment access');
  perform t.ok(public.rpc_audit_count_like('exemption.granted') >= 2, 'grants are audited');
  perform t.ok(public.rpc_verify_audit_chain() is null, 'audit chain intact after onboarding');
end $$;
