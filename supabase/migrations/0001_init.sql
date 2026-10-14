-- Session Hub: schema, row level security, functions and realtime.
--
-- Run once on a fresh Supabase project, either with `supabase db push` or by pasting this
-- whole file into the SQL editor. Afterwards set the organizer code (see README):
--   select public.set_organizer_code('your-organizer-code');
--
-- Security model in short:
--   * Every visitor is an anonymous Supabase user (role `authenticated`, is_anonymous = true).
--   * The `anon` role (no session at all) gets no access to anything.
--   * Join codes and the organizer code are stored only as bcrypt hashes and are verified
--     inside SECURITY DEFINER functions. The plaintext join code is kept in a table that
--     only organizers can read.
--   * Participants write only their own rows, only in sessions they joined. Moderation
--     fields are not writable by participants at all (column-level grants).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Private schema: not exposed through the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

create table private.settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

-- Failed code attempts, used to slow down guessing of join and organizer codes.
create table private.code_attempts (
  user_id      uuid not null,
  kind         text not null check (kind in ('join', 'organizer')),
  attempted_at timestamptz not null default now()
);
create index code_attempts_lookup on private.code_attempts (user_id, kind, attempted_at);

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.sessions (
  id           uuid primary key default gen_random_uuid(),
  title        text not null check (char_length(btrim(title)) between 1 and 90),
  session_date date,
  is_open      boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.session_secrets (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  code_hash  text not null,
  code_plain text not null check (code_plain ~ '^[A-Z0-9]{4,12}$')
);

create table public.organizers (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.session_members (
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index session_members_user on public.session_members (user_id);

create table public.profiles (
  session_id uuid not null,
  user_id    uuid not null default auth.uid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  role       text not null default '' check (char_length(role) <= 80),
  org        text not null default '' check (char_length(org) <= 80),
  goal       text not null default '' check (char_length(goal) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, user_id),
  foreign key (session_id, user_id) references public.session_members (session_id, user_id) on delete cascade
);
create index profiles_user on public.profiles (user_id);

create table public.questions (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null,
  user_id     uuid not null default auth.uid(),
  text        text not null check (char_length(btrim(text)) between 1 and 500),
  created_at  timestamptz not null default now(),
  answered    boolean not null default false,
  hidden      boolean not null default false,
  answer_text text check (char_length(answer_text) <= 1000),
  answered_at timestamptz,
  unique (id, session_id),
  foreign key (session_id, user_id) references public.session_members (session_id, user_id) on delete cascade
);
create index questions_session on public.questions (session_id);

create table public.question_votes (
  question_id uuid not null,
  session_id  uuid not null,
  user_id     uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (question_id, user_id),
  foreign key (question_id, session_id) references public.questions (id, session_id) on delete cascade,
  foreign key (session_id, user_id) references public.session_members (session_id, user_id) on delete cascade
);
create index question_votes_session on public.question_votes (session_id);

create table public.prompts (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  text       text not null check (char_length(btrim(text)) between 1 and 300),
  is_open    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, session_id)
);
create index prompts_session on public.prompts (session_id);

create table public.prompt_answers (
  prompt_id  uuid not null,
  session_id uuid not null,
  user_id    uuid not null default auth.uid(),
  text       text not null check (char_length(btrim(text)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (prompt_id, user_id),
  foreign key (prompt_id, session_id) references public.prompts (id, session_id) on delete cascade,
  foreign key (session_id, user_id) references public.session_members (session_id, user_id) on delete cascade
);
create index prompt_answers_session on public.prompt_answers (session_id);

-- Keep updated_at current.
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();
create trigger prompt_answers_touch before update on public.prompt_answers
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Helper functions used by policies
-- ---------------------------------------------------------------------------
create function public.is_organizer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organizers where user_id = auth.uid());
$$;

create function public.is_member(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.session_members
    where session_id = p_session_id and user_id = auth.uid()
  );
$$;

create function private.normalize_code(p_code text) returns text
language sql immutable set search_path = '' as $$
  select upper(btrim(coalesce(p_code, '')));
$$;

create function private.require_organizer() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_organizer() then
    raise exception 'Organizer access required' using errcode = '42501';
  end if;
end $$;

-- True when the caller has made too many failed attempts recently (10 per 10 minutes).
create function private.too_many_attempts(p_kind text) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) >= 10 from private.code_attempts
  where user_id = auth.uid() and kind = p_kind and attempted_at > now() - interval '10 minutes';
$$;

create function private.record_failed_attempt(p_kind text) returns void
language sql security definer set search_path = '' as $$
  delete from private.code_attempts where attempted_at < now() - interval '1 day';
  insert into private.code_attempts (user_id, kind) values (auth.uid(), p_kind);
$$;

-- ---------------------------------------------------------------------------
-- RPC functions
-- Status-returning functions return text instead of raising on a wrong code, so the
-- failed attempt that was recorded is not rolled back.
-- ---------------------------------------------------------------------------

-- Admin only: run manually in the SQL editor. Not callable through the API.
create function public.set_organizer_code(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_code, ''))) < 8 then
    raise exception 'Use an organizer code of at least 8 characters';
  end if;
  insert into private.settings (key, value, updated_at)
  values ('organizer_code_hash', extensions.crypt(btrim(p_code), extensions.gen_salt('bf', 10)), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;
end $$;

-- Returns 'ok', 'wrong_code', 'rate_limited' or 'not_configured'.
create function public.unlock_organizer(p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if public.is_organizer() then
    return 'ok';
  end if;
  select value into v_hash from private.settings where key = 'organizer_code_hash';
  if v_hash is null then
    return 'not_configured';
  end if;
  if private.too_many_attempts('organizer') then
    return 'rate_limited';
  end if;
  if extensions.crypt(btrim(coalesce(p_code, '')), v_hash) <> v_hash then
    perform private.record_failed_attempt('organizer');
    return 'wrong_code';
  end if;
  insert into public.organizers (user_id) values (auth.uid()) on conflict do nothing;
  return 'ok';
end $$;

create function public.lock_organizer() returns void
language sql security definer set search_path = '' as $$
  delete from public.organizers where user_id = auth.uid();
$$;

-- Returns 'ok', 'wrong_code', 'closed', 'not_found' or 'rate_limited'.
-- Organizers join any session without a code (needed to post their own intro).
create function public.join_session(p_session_id uuid, p_code text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_open boolean;
  v_hash text;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select s.is_open, ss.code_hash into v_open, v_hash
  from public.sessions s join public.session_secrets ss on ss.session_id = s.id
  where s.id = p_session_id;
  if not found then
    return 'not_found';
  end if;
  if public.is_member(p_session_id) then
    return 'ok';
  end if;
  if not public.is_organizer() then
    if not v_open then
      return 'closed';
    end if;
    if private.too_many_attempts('join') then
      return 'rate_limited';
    end if;
    if extensions.crypt(private.normalize_code(p_code), v_hash) <> v_hash then
      perform private.record_failed_attempt('join');
      return 'wrong_code';
    end if;
  end if;
  insert into public.session_members (session_id, user_id) values (p_session_id, auth.uid())
  on conflict do nothing;
  return 'ok';
end $$;

create function public.create_session(p_title text, p_date date, p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := private.normalize_code(p_code);
  v_id uuid;
begin
  perform private.require_organizer();
  if v_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Use a join code of 4 to 12 letters or digits' using errcode = '22023';
  end if;
  insert into public.sessions (title, session_date) values (btrim(p_title), p_date) returning id into v_id;
  insert into public.session_secrets (session_id, code_hash, code_plain)
  values (v_id, extensions.crypt(v_code, extensions.gen_salt('bf', 8)), v_code);
  return v_id;
end $$;

create function public.set_session_code(p_session_id uuid, p_code text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_code text := private.normalize_code(p_code);
begin
  perform private.require_organizer();
  if v_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Use a join code of 4 to 12 letters or digits' using errcode = '22023';
  end if;
  update public.session_secrets
  set code_hash = extensions.crypt(v_code, extensions.gen_salt('bf', 8)), code_plain = v_code
  where session_id = p_session_id;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
end $$;

create function public.set_session_open(p_session_id uuid, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_organizer();
  update public.sessions set is_open = p_open where id = p_session_id;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
end $$;

-- Cascades to secrets, members, profiles, questions, votes, prompts and answers.
create function public.delete_session(p_session_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_organizer();
  delete from public.sessions where id = p_session_id;
end $$;

-- Null arguments leave a field unchanged. Pass '' as p_answer_text to remove an answer.
create function public.moderate_question(
  p_question_id uuid, p_answered boolean, p_hidden boolean, p_answer_text text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_organizer();
  if char_length(p_answer_text) > 1000 then
    raise exception 'Answer is too long' using errcode = '22001';
  end if;
  update public.questions set
    answered    = coalesce(p_answered, answered),
    hidden      = coalesce(p_hidden, hidden),
    answer_text = case when p_answer_text is null then answer_text else nullif(btrim(p_answer_text), '') end,
    answered_at = case
      when coalesce(p_answered, answered) and not answered then now()
      when not coalesce(p_answered, answered) then null
      else answered_at end
  where id = p_question_id;
  if not found then
    raise exception 'Question not found' using errcode = 'P0002';
  end if;
end $$;

-- Per-session counts for the organizer view.
create function public.session_stats()
returns table (session_id uuid, people integer, open_questions integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_organizer();
  return query
    select s.id,
      (select count(*)::int from public.profiles p where p.session_id = s.id),
      (select count(*)::int from public.questions q where q.session_id = s.id and not q.answered and not q.hidden)
    from public.sessions s;
end $$;

-- Function privileges: nothing for `anon`; authenticated users get the public RPCs only.
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.set_organizer_code(text) from public, anon, authenticated;
revoke execute on function
  public.is_organizer(), public.is_member(uuid), public.unlock_organizer(text), public.lock_organizer(),
  public.join_session(uuid, text), public.create_session(text, date, text),
  public.set_session_code(uuid, text), public.set_session_open(uuid, boolean),
  public.delete_session(uuid), public.moderate_question(uuid, boolean, boolean, text),
  public.session_stats()
  from public, anon;
grant execute on function
  public.is_organizer(), public.is_member(uuid), public.unlock_organizer(text), public.lock_organizer(),
  public.join_session(uuid, text), public.create_session(text, date, text),
  public.set_session_code(uuid, text), public.set_session_open(uuid, boolean),
  public.delete_session(uuid), public.moderate_question(uuid, boolean, boolean, text),
  public.session_stats()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges. Start from nothing, then grant exactly what the app needs.
-- ---------------------------------------------------------------------------
revoke all on public.sessions, public.session_secrets, public.organizers, public.session_members,
  public.profiles, public.questions, public.question_votes, public.prompts, public.prompt_answers
  from anon, authenticated;

grant select on public.sessions to authenticated;
grant select (session_id, code_plain) on public.session_secrets to authenticated;
grant select on public.organizers to authenticated;
grant select on public.session_members to authenticated;
grant select, insert (session_id, name, role, org, goal), update (name, role, org, goal)
  on public.profiles to authenticated;
grant select, insert (session_id, text), delete on public.questions to authenticated;
grant select, insert (question_id, session_id), delete on public.question_votes to authenticated;
grant select, insert (session_id, text, is_open), update (text, is_open), delete
  on public.prompts to authenticated;
grant select, insert (prompt_id, session_id, text), update (text) on public.prompt_answers to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.sessions        enable row level security;
alter table public.session_secrets enable row level security;
alter table public.organizers      enable row level security;
alter table public.session_members enable row level security;
alter table public.profiles        enable row level security;
alter table public.questions       enable row level security;
alter table public.question_votes  enable row level security;
alter table public.prompts         enable row level security;
alter table public.prompt_answers  enable row level security;

-- Sessions: the list is visible to every signed-in (also anonymous) user.
-- Writes go through the organizer functions only.
create policy "sessions: read" on public.sessions
  for select to authenticated using (true);

create policy "session_secrets: organizers read" on public.session_secrets
  for select to authenticated using ((select public.is_organizer()));

create policy "organizers: read own" on public.organizers
  for select to authenticated using (user_id = (select auth.uid()));

create policy "session_members: read own or organizer" on public.session_members
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_organizer()));

-- Profiles
create policy "profiles: members and organizers read" on public.profiles
  for select to authenticated
  using (public.is_member(session_id) or (select public.is_organizer()));
create policy "profiles: insert own as member" on public.profiles
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(session_id));
create policy "profiles: update own as member" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_member(session_id))
  with check (user_id = (select auth.uid()) and public.is_member(session_id));

-- Questions: hidden questions are only visible to organizers.
create policy "questions: members and organizers read" on public.questions
  for select to authenticated
  using ((public.is_member(session_id) and not hidden) or (select public.is_organizer()));
create policy "questions: insert own as member" on public.questions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(session_id));
create policy "questions: delete own" on public.questions
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Votes
create policy "question_votes: members and organizers read" on public.question_votes
  for select to authenticated
  using (public.is_member(session_id) or (select public.is_organizer()));
create policy "question_votes: insert own as member" on public.question_votes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_member(session_id));
create policy "question_votes: delete own" on public.question_votes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Prompts (questions from the trainers)
create policy "prompts: members and organizers read" on public.prompts
  for select to authenticated
  using (public.is_member(session_id) or (select public.is_organizer()));
create policy "prompts: organizers insert" on public.prompts
  for insert to authenticated with check ((select public.is_organizer()));
create policy "prompts: organizers update" on public.prompts
  for update to authenticated
  using ((select public.is_organizer())) with check ((select public.is_organizer()));
create policy "prompts: organizers delete" on public.prompts
  for delete to authenticated using ((select public.is_organizer()));

-- Prompt answers: own row only, and only while the prompt is open.
create policy "prompt_answers: members and organizers read" on public.prompt_answers
  for select to authenticated
  using (public.is_member(session_id) or (select public.is_organizer()));
create policy "prompt_answers: insert own while open" on public.prompt_answers
  for insert to authenticated
  with check (
    user_id = (select auth.uid()) and public.is_member(session_id)
    and exists (select 1 from public.prompts p where p.id = prompt_id and p.is_open)
  );
create policy "prompt_answers: update own while open" on public.prompt_answers
  for update to authenticated
  using (user_id = (select auth.uid()) and public.is_member(session_id))
  with check (
    user_id = (select auth.uid()) and public.is_member(session_id)
    and exists (select 1 from public.prompts p where p.id = prompt_id and p.is_open)
  );

-- ---------------------------------------------------------------------------
-- Realtime: broadcast changes on these tables. Realtime applies the RLS policies above
-- per subscriber, so nobody receives rows they could not select.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['sessions', 'profiles', 'questions', 'question_votes', 'prompts', 'prompt_answers']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

