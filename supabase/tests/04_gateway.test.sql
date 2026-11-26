-- Gateway protections: meeting links hidden from students, wrappers server-only, join tokens single use.
-- Fixture ids come from 01_fixtures_and_policies.test.sql (student 04 is enrolled in class/session fixtures).
do $$
declare v_student uuid := '00000000-0000-0000-0000-000000000004'; v_session uuid := '50000000-0000-0000-0000-000000000001';
        v_url text; h bytea := extensions.digest('tok-1', 'sha256'); r text;
begin
  update public.sessions set meeting_url = 'https://meet.example.com/abc' where id = v_session;

  -- a student cannot read the meeting link through the Data API
  perform set_config('request.jwt.claim.sub', v_student::text, true);
  set local role authenticated;
  begin
    perform meeting_url from public.sessions where id = v_session;
    reset role; raise exception 'FAIL: student read meeting_url';
  exception when insufficient_privilege then reset role; end;
  perform t.ok(true, 'blocked: student cannot read sessions.meeting_url');

  -- but still reads the rest of the session
  perform t.ok(t.count_as(v_student, 'select id from public.sessions') >= 1, 'student still reads session rows');

  -- wrappers are not callable by authenticated users
  perform set_config('request.jwt.claim.sub', v_student::text, true);
  set local role authenticated;
  begin
    perform public.rpc_meeting_url(v_session);
    reset role; raise exception 'FAIL: authenticated called rpc_meeting_url';
  exception when insufficient_privilege then reset role; end;
  perform t.ok(true, 'blocked: wrappers are service_role only');

  -- join token: valid once, then dead; wrong student fails
  perform public.rpc_mint_join_token(v_session, v_student, h, 5);
  v_url := public.rpc_consume_join_token(h, '00000000-0000-0000-0000-000000000005');
  perform t.ok(v_url is null, 'join token refused for a different student');
  v_url := public.rpc_consume_join_token(h, v_student);
  perform t.ok(v_url = 'https://meet.example.com/abc', 'join token redeems to the meeting link');
  v_url := public.rpc_consume_join_token(h, v_student);
  perform t.ok(v_url is null, 'join token is single use');

  -- device binding: first active, second pending
  r := public.rpc_register_device(v_student, extensions.digest('d1', 'sha256'), 'phone');
  perform t.ok(r = 'active', 'first device is active');
  r := public.rpc_register_device(v_student, extensions.digest('d2', 'sha256'), 'laptop');
  perform t.ok(r = 'pending', 'second device waits for approval');
  perform t.ok(public.rpc_device_status(v_student, extensions.digest('d9', 'sha256')) = 'unknown', 'unknown device reported as unknown');
end $$;

-- Device approval authority.
do $$
declare v_student uuid := '00000000-0000-0000-0000-000000000004'; dev uuid; ok boolean := false;
begin
  select id into dev from private.devices where user_id = v_student and status = 'pending';
  perform t.ok(dev is not null, 'a pending device exists to approve');
  begin perform public.rpc_approve_device('00000000-0000-0000-0000-000000000004', dev);   -- the student themselves
  exception when insufficient_privilege then ok := true; end;
  perform t.ok(ok, 'student cannot approve their own device');
  perform t.ok(public.rpc_verify_audit_chain() is null, 'audit chain intact');
end $$;
