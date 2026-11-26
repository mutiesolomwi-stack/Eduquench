-- Join eligibility: returns 'ok' or a machine-readable reason. Used by the join gateway.
create function private.check_join(p_student uuid, p_session uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare s public.sessions; o public.org_status; v_enrol uuid; v_ok boolean;
begin
  select * into s from public.sessions where id = p_session;
  if not found then return 'session_not_found'; end if;
  if s.status = 'cancelled' then return 'session_cancelled'; end if;
  select status into o from public.organizations where id = s.org_id;
  if o is distinct from 'approved' then return 'school_not_approved'; end if;
  select id into v_enrol from public.enrollments
    where class_id = s.class_id and student_id = p_student and status = 'approved';
  if v_enrol is null then return 'not_enrolled'; end if;
  select exists (
    select 1 from public.entitlements e
    where e.class_id = s.class_id and e.student_id = p_student and e.status = 'active'
      and (e.valid_until is null or e.valid_until > now())
      and (e.sessions_remaining is null or e.sessions_remaining > 0)
  ) into v_ok;
  if not v_ok then return 'no_entitlement'; end if;
  if now() < s.starts_at - interval '15 minutes' or now() > s.ends_at then return 'outside_time_window'; end if;
  return 'ok';
end $$;

-- Atomic payment confirmation: payment + ledger + entitlement + credentials + audit.
-- Idempotent on the M-Pesa receipt. Server (service_role) only.
create function private.confirm_payment(
  p_intent uuid, p_receipt text, p_amount numeric, p_phone text,
  p_link_token_hash bytea, p_code_hash bytea)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i private.payment_intents; f public.fee_plans; v_pay uuid; v_ent uuid;
        v_pct numeric; v_comm numeric; v_valid timestamptz; v_sessions int;
begin
  select * into i from private.payment_intents where id = p_intent for update;
  if not found then raise exception 'unknown intent'; end if;
  if exists (select 1 from public.payments where mpesa_receipt = p_receipt) then
    return null;                                           -- replayed callback: do nothing
  end if;
  if i.amount <> p_amount or i.phone <> p_phone then
    raise exception 'amount or phone mismatch' using errcode = '22023';
  end if;
  select * into f from public.fee_plans where id = i.fee_plan_id;

  insert into public.payments (org_id, intent_id, payer_id, beneficiary_id, fee_plan_id, mpesa_receipt, amount)
  values (i.org_id, i.id, i.payer_id, i.beneficiary_id, f.id, p_receipt, p_amount) returning id into v_pay;

  select coalesce((select percent from private.commission_rules
                   where org_id = i.org_id order by effective_from desc limit 1),
                  (select percent from private.commission_rules
                   where org_id is null order by effective_from desc limit 1), 0) into v_pct;
  v_comm := round(p_amount * v_pct / 100, 2);
  insert into private.ledger_entries (org_id, payment_id, kind, amount) values
    (i.org_id, v_pay, 'collection', p_amount),
    (i.org_id, v_pay, 'commission', v_comm),
    (i.org_id, v_pay, 'school_share', p_amount - v_comm);

  v_sessions := f.sessions_covered;
  v_valid := case f.kind when 'monthly' then now() + interval '31 days'
                         when 'instalment' then now() + interval '31 days' else null end;
  insert into public.entitlements (org_id, class_id, student_id, payment_id, sessions_remaining, valid_until)
  values (i.org_id, f.class_id, i.beneficiary_id, v_pay, v_sessions, v_valid) returning id into v_ent;

  insert into private.access_credentials (entitlement_id, payment_id, link_token_hash, code_hash)
  values (v_ent, v_pay, p_link_token_hash, p_code_hash);

  update private.payment_intents set status = 'confirmed' where id = i.id;
  perform private.write_audit(i.org_id, i.payer_id, 'payment.confirmed', 'payment', v_pay::text, null,
    jsonb_build_object('amount', p_amount, 'beneficiary', i.beneficiary_id, 'entitlement', v_ent), null, 'daraja');
  return v_ent;
end $$;

-- Teacher/admin override: reason mandatory, authority checked in the database, audited.
create function private.apply_override(p_actor uuid, p_session uuid, p_enrollment uuid,
  p_status public.attendance_status, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.sessions; r public.attendance_records; v_id uuid; v_ok boolean;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'override reason required' using errcode = '22023';
  end if;
  select * into s from public.sessions where id = p_session;
  if not found then raise exception 'unknown session'; end if;
  select exists (
    select 1 from public.memberships m where m.user_id = p_actor and m.status = 'active'
      and (m.role = 'system_admin' or (m.org_id = s.org_id and m.role = 'school_admin'))
    union all
    select 1 from public.class_staff cs where cs.class_id = s.class_id and cs.user_id = p_actor and cs.role = 'teacher'
  ) into v_ok;
  if not v_ok then raise exception 'not allowed to override' using errcode = '42501'; end if;

  select * into r from public.attendance_records where session_id = p_session and enrollment_id = p_enrollment;
  insert into public.overrides (org_id, session_id, enrollment_id, status, reason, author_id)
  values (s.org_id, p_session, p_enrollment, p_status, p_reason, p_actor) returning id into v_id;
  insert into public.attendance_events (org_id, session_id, enrollment_id, student_id, type, meta)
  select s.org_id, p_session, p_enrollment, e.student_id, 'override_applied',
         jsonb_build_object('status', p_status, 'by', p_actor)
  from public.enrollments e where e.id = p_enrollment;
  update public.attendance_records set effective_status = p_status
    where session_id = p_session and enrollment_id = p_enrollment;
  perform private.write_audit(s.org_id, p_actor, 'attendance.override', 'attendance_record',
    coalesce(r.id::text, p_enrollment::text),
    jsonb_build_object('status', r.effective_status), jsonb_build_object('status', p_status), p_reason, 'teacher');
  return v_id;
end $$;

-- The one deterministic status function (ARD section 6).
create function private.compute_attendance(p_session uuid, p_enrollment uuid)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions; e public.enrollments; rules jsonb;
  v_grace interval; v_late int; v_early int; v_min_pct numeric; v_min_checks int;
  v_first timestamptz; v_last timestamptz; v_left timestamptz; v_secs numeric := 0;
  v_sent int; v_passed int; v_required int; v_dur numeric;
  v_status public.attendance_status; v_pending boolean; v_late_m int := 0; v_early_m int := 0;
  v_override public.attendance_status; v_conf public.confidence_level; v_platform boolean;
  rec record; prev_t timestamptz; prev_type public.event_type; out public.attendance_records;
begin
  select * into s from public.sessions where id = p_session;
  select * into e from public.enrollments where id = p_enrollment;
  rules := coalesce(s.frozen_rules, (select c.rules from public.classes c where c.id = s.class_id));
  v_grace := make_interval(mins => coalesce((rules->>'grace_minutes')::int, 10));
  v_late := coalesce((rules->>'late_minutes')::int, 20);
  v_early := coalesce((rules->>'early_minutes')::int, 20);
  v_min_pct := coalesce((rules->>'min_presence_pct')::numeric, 75);
  v_min_checks := coalesce((rules->>'min_checks')::int, 2);
  v_dur := extract(epoch from (s.ends_at - s.starts_at));

  -- Presence = sum of gaps between consecutive evidence points that are within the grace period.
  -- A leave event ends presence: the gap after it is not counted.
  for rec in
    select occurred_at, type from public.attendance_events
    where session_id = p_session and enrollment_id = p_enrollment
      and type in ('join','heartbeat','code_submitted','challenge_answered','leave')
      and occurred_at <= s.ends_at + v_grace
    order by occurred_at, id
  loop
    if v_first is null then v_first := rec.occurred_at; end if;
    if prev_t is not null and prev_type <> 'leave' and rec.occurred_at - prev_t <= v_grace then
      v_secs := v_secs + extract(epoch from (least(rec.occurred_at, s.ends_at) - least(prev_t, s.ends_at)));
    end if;
    if rec.type = 'leave' then v_left := rec.occurred_at; else v_left := null; end if;
    prev_t := rec.occurred_at; prev_type := rec.type; v_last := rec.occurred_at;
  end loop;
  -- Tail: last point to the end of the session counts if the student did not leave and it is within grace.
  if prev_t is not null and prev_type <> 'leave' and now() >= s.ends_at
     and s.ends_at > prev_t and s.ends_at - prev_t <= v_grace then
    v_secs := v_secs + extract(epoch from (s.ends_at - prev_t));
  end if;

  select count(*) filter (where sent_at is not null or due_at <= now()),
         count(*) filter (where passed is true)
    into v_sent, v_passed from public.challenges where session_id = p_session and enrollment_id = p_enrollment;
  v_required := case when v_sent < 3 then v_sent else v_min_checks end;

  select exists (select 1 from public.connection_claims
                 where session_id = p_session and enrollment_id = p_enrollment and status = 'pending') into v_pending;
  select exists (select 1 from public.attendance_events
                 where session_id = p_session and enrollment_id = p_enrollment
                   and type in ('platform_join','platform_leave')) into v_platform;

  if v_first is not null then
    v_late_m := greatest(0, floor(extract(epoch from (v_first - s.starts_at)) / 60)::int);
    v_early_m := greatest(0, floor(extract(epoch from (s.ends_at - coalesce(v_left, v_last))) / 60)::int);
    if v_left is null and now() < s.ends_at then v_early_m := 0; end if;  -- still in the lesson
  end if;

  if v_pending then v_status := 'pending_review';          -- an open connection claim waits for the teacher, even with no evidence
  elsif v_first is null then v_status := 'absent';
  elsif v_late_m > v_late then v_status := 'late';
  elsif v_left is not null and v_early_m > v_early then v_status := 'left_early';
  elsif v_secs / nullif(v_dur, 0) * 100 >= v_min_pct and v_passed >= v_required then v_status := 'verified_present';
  else v_status := 'partial';
  end if;

  v_conf := case when v_platform and v_passed >= v_required then 'high'
                 when v_platform then 'medium' else 'low' end;

  select o.status into v_override from public.overrides o
    where o.session_id = p_session and o.enrollment_id = p_enrollment order by o.created_at desc, o.id desc limit 1;

  insert into public.attendance_records as a (org_id, session_id, enrollment_id, student_id, computed_status, effective_status,
      seconds_present, late_minutes, early_minutes, checks_sent, checks_passed, confidence, computed_at)
  values (s.org_id, p_session, p_enrollment, e.student_id, v_status, coalesce(v_override, v_status),
      round(v_secs)::int, v_late_m, v_early_m, v_sent, v_passed, v_conf, now())
  on conflict (session_id, enrollment_id) do update set
      computed_status = excluded.computed_status, effective_status = excluded.effective_status,
      seconds_present = excluded.seconds_present, late_minutes = excluded.late_minutes,
      early_minutes = excluded.early_minutes, checks_sent = excluded.checks_sent,
      checks_passed = excluded.checks_passed, confidence = excluded.confidence, computed_at = now()
  returning a.* into out;
  return out;
end $$;

-- Lock down function execution: nothing in private is callable by anon; mutators are service_role only.
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_system_admin(), private.has_org_role(uuid, public.app_role[]),
  private.is_org_member(uuid), private.is_guardian_of(uuid), private.is_class_staff(uuid),
  private.is_class_member(uuid) to authenticated, service_role;
grant execute on function private.check_join(uuid, uuid), private.confirm_payment(uuid, text, numeric, text, bytea, bytea),
  private.apply_override(uuid, uuid, uuid, public.attendance_status, text),
  private.compute_attendance(uuid, uuid), private.write_audit(uuid, uuid, text, text, text, jsonb, jsonb, text, text),
  private.verify_audit_chain() to service_role;
