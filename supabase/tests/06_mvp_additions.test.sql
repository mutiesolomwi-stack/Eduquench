do $$
declare org uuid := 'a0000000-0000-0000-0000-000000000001'; admin1 uuid := '00000000-0000-0000-0000-000000000002';
  teacher uuid := '00000000-0000-0000-0000-000000000003'; stud uuid := '00000000-0000-0000-0000-000000000004';
  stud2 uuid := '00000000-0000-0000-0000-000000000005'; other_admin uuid := '00000000-0000-0000-0000-000000000007';
  cls uuid := 'c0000000-0000-0000-0000-000000000001'; ses uuid := '50000000-0000-0000-0000-000000000001';
  ok boolean; n int; v_id uuid; v_class uuid; v_plan uuid; v_intent jsonb; v_ent uuid; v_claim uuid; v_enr uuid;
  link text := 'link-token-1'; code text := 'CODE2345'; r jsonb;
begin
  -- ---- profile rules ----
  ok := false; begin perform public.rpc_complete_profile(stud, 'A', '0712345678', null, '1', null, true, 'G', '+254711000000'); exception when invalid_parameter_value then ok := true; end;
  perform t.ok(ok, 'phone must be +254 format');
  ok := false; begin perform public.rpc_complete_profile(stud, 'A', '+254712345678', null, '1', null, true, '', null); exception when invalid_parameter_value then ok := true; end;
  perform t.ok(ok, 'minor needs guardian name and phone');
  ok := false; begin perform public.rpc_complete_profile(stud, 'A', '+254712345678', '', '1', null, false, null, null); exception when invalid_parameter_value then ok := true; end;
  perform t.ok(ok, 'adult needs email');
  perform public.rpc_complete_profile(stud, 'Amina Otieno', '+254712345678', null, '1042', null, true, 'Mrs Otieno', '+254711000000');
  perform t.ok((select guardian_name from public.profiles where id = stud) = 'Mrs Otieno', 'minor profile saved with guardian');

  -- ---- notifications: critical beats prefs, dedupe, outbox rows ----
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000013', 'quiet@x.test') on conflict do nothing;
  insert into public.profiles (id, full_name, email) values ('00000000-0000-0000-0000-000000000013', 'Quiet', 'quiet@x.test') on conflict (id) do update set email = 'quiet@x.test';
  insert into public.notification_prefs (user_id, push, email) values ('00000000-0000-0000-0000-000000000013', false, false);
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-000000000013', 'https://push.example/1', 'k', 'a');
  v_id := public.rpc_notify('00000000-0000-0000-0000-000000000013', org, 'x', 'Reminder', 'body', false, array['email','push'], 'd1');
  perform t.ok(v_id is not null and not exists (select 1 from private.outbox where notification_id = v_id), 'opted-out user gets no email or push for a normal notice');
  v_id := public.rpc_notify('00000000-0000-0000-0000-000000000013', org, 'payment.receipt', 'Receipt', 'body', true, array['email','push'], 'd2');
  perform t.ok((select count(*) from private.outbox where notification_id = v_id) = 2, 'critical notice ignores opt-out (email and push)');
  perform t.ok(public.rpc_notify('00000000-0000-0000-0000-000000000013', org, 'payment.receipt', 'Receipt', 'body', true, array['email'], 'd2') is null, 'same dedupe key sends once');

  -- ---- outbox claim, retry, permanent failure ----
  perform t.ok((select count(*) from public.rpc_claim_outbox(10)) >= 2, 'worker claims waiting rows');
  perform t.ok((select count(*) from public.rpc_claim_outbox(10)) = 0, 'claimed rows are leased and not handed out twice');
  update private.outbox set next_attempt_at = now() where notification_id = v_id;
  perform public.rpc_outbox_result((select id from private.outbox where notification_id = v_id and channel = 'email'), true, false, 0, null);
  perform t.ok((select status from private.outbox where notification_id = v_id and channel = 'email') = 'sent', 'sent rows are marked sent');
  perform public.rpc_outbox_result((select id from private.outbox where notification_id = v_id and channel = 'push'), false, false, 60, 'timeout');
  perform t.ok((select status from private.outbox where notification_id = v_id and channel = 'push') = 'waiting', 'a failed send goes back to waiting with back-off');
  perform public.rpc_outbox_result((select id from private.outbox where notification_id = v_id and channel = 'push'), false, true, 0, 'gone');
  perform t.ok((select status from private.outbox where notification_id = v_id and channel = 'push') = 'permanent_failure', 'permanent failures are recorded');

  -- ---- class, fee plan, timetable with holidays ----
  ok := false; begin perform public.rpc_create_class(stud, org, 'Hack', 'recurring', 'pasted_link', null); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot create a class');
  ok := false; begin perform public.rpc_create_class(other_admin, org, 'Hack', 'recurring', 'pasted_link', null); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'other school''s admin cannot create a class here');
  v_class := public.rpc_create_class(teacher, org, 'Grade 9 Science', 'recurring', 'google_meet', 'https://meet.google.com/abc-defg-hij');
  perform t.ok(exists (select 1 from public.class_staff where class_id = v_class and user_id = teacher), 'a teacher who creates a class is staff on it');
  v_plan := public.rpc_create_fee_plan(teacher, v_class, 'per_session', 'Per lesson', 200, 1);
  ok := false; begin perform public.rpc_create_fee_plan(stud, v_class, 'per_session', 'Free', 1, 1); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot create a fee plan');
  perform public.rpc_create_holiday(admin1, org, 'Half term', date '2027-02-17', date '2027-02-19');
  -- Mondays (1) from 2027-02-01 to 2027-02-28: 1, 8, 15, 22 -> none are in the holiday. Use Wednesdays (3): 3, 10, 17(h), 24 -> 3 sessions.
  n := public.rpc_create_timetable(teacher, v_class, 3, time '16:00', time '17:00', date '2027-02-01', date '2027-02-28', 'Science');
  perform t.ok(n = 3, 'Wednesdays in Feb 2027 minus the half-term Wednesday = 3 sessions (got ' || n || ')');
  perform t.ok((select min(starts_at) from public.sessions where class_id = v_class) = timestamptz '2027-02-03 16:00:00+03', 'sessions are stored at 16:00 East Africa Time');
  n := public.rpc_create_timetable(teacher, v_class, 3, time '16:00', time '17:00', date '2027-02-01', date '2027-02-28', 'Science');
  perform t.ok((select count(*) from public.sessions where class_id = v_class) = 3 , 'running a timetable twice does not duplicate sessions');

  -- cancel notifies enrolled students; only scheduled sessions
  perform public.rpc_assign_teacher(admin1, v_class, teacher);
  ok := false; begin perform public.rpc_cancel_session(stud, (select id from public.sessions where class_id = v_class limit 1), 'x'); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot cancel a session');
  perform public.rpc_cancel_session(teacher, (select id from public.sessions where class_id = v_class order by starts_at limit 1), 'Teacher unwell');
  perform t.ok((select count(*) from public.sessions where class_id = v_class and status = 'cancelled') = 1, 'teacher cancels a session');

  -- ---- access pack: only the beneficiary can open it ----
  insert into public.enrollments (org_id, class_id, student_id, status) values (org, v_class, stud, 'approved') on conflict do nothing;
  v_intent := public.rpc_create_intent(stud, stud, v_plan, '254712345678');
  v_ent := public.rpc_confirm_payment((v_intent->>'id')::uuid, 'TKA1B2C3D4', 200, '254712345678', extensions.digest(link, 'sha256'), extensions.digest(code, 'sha256'));
  perform t.ok(v_ent is not null, 'payment confirmed through the wrapper');
  r := public.rpc_open_access_link(stud, extensions.digest(link, 'sha256'));
  perform t.ok(r->>'class_name' = 'Grade 9 Science', 'beneficiary opens the access link');
  perform t.ok(public.rpc_open_access_link(stud2, extensions.digest(link, 'sha256')) is null, 'someone else cannot open the access link');
  perform t.ok(public.rpc_verify_access_code(stud, extensions.digest(code, 'sha256')) is not null, 'beneficiary verifies the access code');
  perform t.ok(public.rpc_verify_access_code(stud2, extensions.digest(code, 'sha256')) is null, 'someone else cannot use the access code');
  perform t.ok(public.rpc_verify_access_code(stud, extensions.digest('WRONG123', 'sha256')) is null, 'wrong code rejected');

  -- ---- connection-problem claims ----
  select id into v_enr from public.enrollments where class_id = cls and student_id = stud2;
  ok := false; begin perform public.rpc_submit_claim('00000000-0000-0000-0000-000000000008', ses, 'bundle ran out'); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot claim on a class they are not in');
  v_claim := public.rpc_submit_claim(stud2, ses, 'my data bundle ran out mid-lesson');
  perform t.ok((select effective_status from public.attendance_records where session_id = ses and enrollment_id = v_enr) = 'pending_review', 'a claim moves the record to pending review');
  ok := false; begin perform public.rpc_submit_claim(stud2, ses, 'again'); exception when unique_violation then ok := true; end;
  perform t.ok(ok, 'only one pending claim per session');
  select count(*) into n from public.rpc_pending_claims(teacher) where claim_id = v_claim; perform t.ok(n = 1, 'teacher sees the pending claim');
  select count(*) into n from public.rpc_pending_claims(other_admin) where claim_id = v_claim; perform t.ok(n = 0, 'other school''s admin sees no claims');
  ok := false; begin perform public.rpc_decide_claim(stud2, v_claim, true, 'verified_present', 'trust me'); exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot decide their own claim');
  ok := false; begin perform public.rpc_decide_claim(teacher, v_claim, true, 'verified_present', ' '); exception when invalid_parameter_value then ok := true; end;
  perform t.ok(ok, 'deciding needs a reason');
  perform public.rpc_decide_claim(teacher, v_claim, true, 'excused', 'confirmed outage on the school network');
  perform t.ok((select effective_status from public.attendance_records where session_id = ses and enrollment_id = v_enr) = 'excused', 'approved claim becomes an override on the record');
  perform t.ok((select count(*) from public.overrides where session_id = ses and enrollment_id = v_enr and reason like 'Connection claim approved%') = 1, 'override carries the reason');
  perform t.ok((select status from public.connection_claims where id = v_claim) = 'approved', 'claim marked approved');
  perform t.ok(exists (select 1 from public.notifications where user_id = stud2 and kind = 'claim.decided'), 'student is told the decision');
  perform t.ok(public.rpc_verify_audit_chain() is null, 'audit chain intact after all of the above');
end $$;
