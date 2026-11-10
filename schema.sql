-- Run once in the Supabase SQL Editor. Do not put the service-role key in browser code.
-- This schema is designed for a small, anonymous student study.

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  version text not null check (version in ('A','B')),
  step integer not null default 0 check (step between 0 and 7),
  answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists study_sessions_started_idx on public.study_sessions(started_at);
create index if not exists study_sessions_version_idx on public.study_sessions(version);

alter table public.study_sessions enable row level security;
revoke all on public.study_sessions from anon, authenticated;
-- Only the server-side service role will read the results.
grant select on public.study_sessions to service_role;

create or replace function public.start_study()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  count_a integer;
  count_b integer;
  chosen text;
  new_id uuid;
begin
  -- Serializes all concurrent allocations, keeping ACTIVE assignments balanced.
  perform pg_advisory_xact_lock(202611101);
  -- Remove abandoned incomplete sessions after two hours; completed data is retained.
  delete from public.study_sessions
  where completed_at is null and started_at < now() - interval '2 hours';

  select count(*) filter (where version = 'A'),
         count(*) filter (where version = 'B')
  into count_a, count_b
  from public.study_sessions;

  chosen := case
    when count_a < count_b then 'A'
    when count_b < count_a then 'B'
    when random() < 0.5 then 'A'
    else 'B'
  end;

  insert into public.study_sessions(version)
  values (chosen)
  returning id into new_id;

  return jsonb_build_object('id', new_id, 'version', chosen, 'step', 0);
end;
$$;

create or replace function public.study_status(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entry record;
begin
  select version, step, completed_at into entry
  from public.study_sessions where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object('version', entry.version, 'step', entry.step,
                           'completed', entry.completed_at is not null);
end;
$$;

create or replace function public.study_answer(p_id uuid, p_step integer, p_choice text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  entry record;
  question_keys text[] := array['scenario1','distraction1','distraction2',
                                 'distraction3','distraction4','distraction5','scenario2'];
  next_step integer;
begin
  if p_choice not in ('A','B') or p_step not between 0 and 6 then
    raise exception 'INVALID_ANSWER' using errcode = '22023';
  end if;

  select step, completed_at into entry from public.study_sessions
  where id = p_id for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = '22023';
  end if;
  if entry.completed_at is not null or entry.step <> p_step then
    raise exception 'OUT_OF_SEQUENCE' using errcode = '22023';
  end if;
  next_step := p_step + 1;

  update public.study_sessions
  set answers = jsonb_set(answers, array[question_keys[p_step + 1]], to_jsonb(p_choice), true),
      step = next_step,
      completed_at = case when next_step = 7 then now() else null end
  where id = p_id;

  return jsonb_build_object('next_step', next_step, 'completed', next_step = 7);
end;
$$;

create or replace function public.study_withdraw(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.study_sessions where id = p_id;
  return found;
end;
$$;

-- Restrict all functions to the server's service role. End users have no direct credentials.
revoke all on function public.start_study() from public, anon, authenticated;
revoke all on function public.study_status(uuid) from public, anon, authenticated;
revoke all on function public.study_answer(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.study_withdraw(uuid) from public, anon, authenticated;
grant execute on function public.start_study() to service_role;
grant execute on function public.study_status(uuid) to service_role;
grant execute on function public.study_answer(uuid, integer, text) to service_role;
grant execute on function public.study_withdraw(uuid) to service_role;
