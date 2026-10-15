-- =============================================================================
-- StudyBoard — 0001_schema.sql
-- Core relational schema: rooms, members, invites, whiteboard, chat, files,
-- annotations, shared timer, audit events and rate-limit buckets.
-- Idempotent: safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- rooms
-- -----------------------------------------------------------------------------
create table if not exists public.rooms (
  id              uuid primary key default extensions.gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  is_locked       boolean not null default false,
  settings        jsonb not null default
                    '{"allow_member_draw":true,"allow_member_clear":false}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_active_at  timestamptz not null default now()
);

create index if not exists rooms_owner_idx        on public.rooms (owner_id);
create index if not exists rooms_last_active_idx  on public.rooms (last_active_at desc);

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- room_members
-- -----------------------------------------------------------------------------
create table if not exists public.room_members (
  id            uuid primary key default extensions.gen_random_uuid(),
  room_id       uuid not null references public.rooms(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  nickname      text not null check (char_length(nickname) between 1 and 32),
  role          text not null default 'member' check (role in ('owner','member')),
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (room_id, user_id)
);

create index if not exists room_members_room_idx on public.room_members (room_id);
create index if not exists room_members_user_idx on public.room_members (user_id);

-- -----------------------------------------------------------------------------
-- invite_codes  (only a SHA-256 hash of the code is ever stored)
-- -----------------------------------------------------------------------------
create table if not exists public.invite_codes (
  id           uuid primary key default extensions.gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  code_hash    text not null,
  code_prefix  text not null,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  revoked      boolean not null default false,
  max_uses     int,
  uses         int not null default 0,
  unique (code_hash)
);

create index if not exists invite_codes_room_idx on public.invite_codes (room_id);
create index if not exists invite_codes_hash_idx on public.invite_codes (code_hash);

-- -----------------------------------------------------------------------------
-- board_pages
-- -----------------------------------------------------------------------------
create table if not exists public.board_pages (
  id          uuid primary key default extensions.gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  name        text not null default 'Page 1' check (char_length(name) between 1 and 60),
  page_index  int  not null default 0,
  snapshot    jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (room_id, page_index)
);

create index if not exists board_pages_room_idx on public.board_pages (room_id, page_index);

drop trigger if exists board_pages_set_updated_at on public.board_pages;
create trigger board_pages_set_updated_at
  before update on public.board_pages
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- board_objects  (durable strokes / shapes / text / sticky / equation / graph)
-- -----------------------------------------------------------------------------
create table if not exists public.board_objects (
  id          uuid primary key default extensions.gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  page_id     uuid not null references public.board_pages(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  kind        text not null check (kind in
                ('stroke','rect','ellipse','line','arrow','text','sticky',
                 'image','equation','graph')),
  data        jsonb not null,
  z           int not null default 0,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists board_objects_page_idx on public.board_objects (page_id)
  where deleted = false;
create index if not exists board_objects_room_idx on public.board_objects (room_id);

drop trigger if exists board_objects_set_updated_at on public.board_objects;
create trigger board_objects_set_updated_at
  before update on public.board_objects
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- chat_messages
-- -----------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id          uuid primary key default extensions.gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  nickname    text not null check (char_length(nickname) between 1 and 32),
  body        text not null check (char_length(body) between 1 and 2000),
  client_id   text check (char_length(client_id) <= 64),
  created_at  timestamptz not null default now(),
  unique (room_id, client_id)
);

create index if not exists chat_messages_room_idx
  on public.chat_messages (room_id, created_at desc);

-- -----------------------------------------------------------------------------
-- documents  (metadata for files stored in Supabase Storage)
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  id           uuid primary key default extensions.gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  uploader_id  uuid references auth.users(id) on delete set null,
  storage_path text not null,
  name         text not null check (char_length(name) between 1 and 200),
  mime         text not null,
  size_bytes   bigint not null check (size_bytes > 0),
  page_count   int,
  created_at   timestamptz not null default now()
);

create index if not exists documents_room_idx on public.documents (room_id, created_at desc);

-- -----------------------------------------------------------------------------
-- annotations  (persisted independently of the source file)
-- -----------------------------------------------------------------------------
create table if not exists public.annotations (
  id           uuid primary key default extensions.gen_random_uuid(),
  room_id      uuid not null references public.rooms(id) on delete cascade,
  document_id  uuid not null references public.documents(id) on delete cascade,
  page_number  int not null default 1 check (page_number >= 1),
  author_id    uuid references auth.users(id) on delete set null,
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists annotations_doc_idx
  on public.annotations (document_id, page_number);

drop trigger if exists annotations_set_updated_at on public.annotations;
create trigger annotations_set_updated_at
  before update on public.annotations
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- timer_state  (exactly one row per room; server-authoritative)
-- -----------------------------------------------------------------------------
create table if not exists public.timer_state (
  room_id             uuid primary key references public.rooms(id) on delete cascade,
  mode                text not null default 'focus' check (mode in ('focus','break')),
  duration_seconds    int  not null default 1500 check (duration_seconds between 60 and 7200),
  running             boolean not null default false,
  started_at          timestamptz,          -- when the current run segment began
  elapsed_before_pause int not null default 0, -- accumulated seconds before current run
  version             int not null default 0,
  updated_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- room_events  (lightweight audit trail)
-- -----------------------------------------------------------------------------
create table if not exists public.room_events (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.rooms(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists room_events_room_idx
  on public.room_events (room_id, created_at desc);

-- -----------------------------------------------------------------------------
-- rate_limits  (fixed-window counters, written only by SECURITY DEFINER fns)
-- -----------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket_key    text primary key,
  window_start  timestamptz not null default now(),
  count         int not null default 0
);
