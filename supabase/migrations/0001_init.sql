-- ============================================================================
-- StudyBoard — 0001_init.sql
-- Tables, indexes, triggers and the storage bucket.
-- Run this first, then 0002_rls.sql and 0003_functions.sql.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- profiles: one row per auth user, created automatically on signup.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Student',
  avatar_url   text,
  theme        text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  notify_email boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Create a profile whenever a new auth user appears.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- rooms
-- ----------------------------------------------------------------------------
create table if not exists public.rooms (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references public.profiles (id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  subject        text,
  invite_code    text not null unique,
  invite_revoked boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists rooms_owner_idx on public.rooms (owner_id);

-- ----------------------------------------------------------------------------
-- room_members (membership + role)
-- ----------------------------------------------------------------------------
create table if not exists public.room_members (
  room_id   uuid not null references public.rooms (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create index if not exists room_members_user_idx on public.room_members (user_id);

-- ----------------------------------------------------------------------------
-- messages
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id         bigint generated always as identity primary key,
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  kind       text not null default 'text' check (kind in ('text', 'system', 'note', 'link')),
  created_at timestamptz not null default now()
);

create index if not exists messages_room_created_idx
  on public.messages (room_id, created_at desc);

-- Server-side rate limit: at most 10 messages per 10 seconds per user.
create or replace function public.enforce_message_rate_limit()
returns trigger language plpgsql as $$
declare
  recent int;
begin
  select count(*) into recent
  from public.messages
  where user_id = new.user_id
    and created_at > now() - interval '10 seconds';
  if recent >= 10 then
    raise exception 'rate limit exceeded: slow down';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

-- ----------------------------------------------------------------------------
-- whiteboard_snapshots (one saved scene per room)
-- ----------------------------------------------------------------------------
create table if not exists public.whiteboard_snapshots (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

-- ----------------------------------------------------------------------------
-- files (metadata for objects in the private `room-files` bucket)
-- ----------------------------------------------------------------------------
create table if not exists public.files (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.rooms (id) on delete cascade,
  uploader_id  uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null,
  name         text not null,
  mime         text not null default 'application/pdf',
  size_bytes   bigint not null default 0 check (size_bytes >= 0),
  created_at   timestamptz not null default now()
);

create index if not exists files_room_idx on public.files (room_id, created_at desc);

-- ----------------------------------------------------------------------------
-- room_state (shared PDF page + timer, server-authoritative)
-- ----------------------------------------------------------------------------
create table if not exists public.room_state (
  room_id     uuid primary key references public.rooms (id) on delete cascade,
  pdf_file_id uuid references public.files (id) on delete set null,
  pdf_page    int not null default 1 check (pdf_page >= 1),
  timer       jsonb not null default
    '{"mode":"pomodoro","durationSec":1500,"startedAt":null,"elapsedMs":0,"running":false}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Storage: private bucket for room study materials
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('room-files', 'room-files', false)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Realtime: broadcast message inserts so chat updates live.
-- (Rooms, presence, cursors, whiteboard ops use Realtime Broadcast, which needs
--  no publication entry.)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
