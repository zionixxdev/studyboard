-- =============================================================================
-- StudyBoard — 0005_realtime.sql
-- Add the durable tables to the Supabase Realtime publication so clients can
-- receive `postgres_changes` streams (chat, board objects, timer, roster,
-- documents, annotations, room state). High-frequency in-progress drawing is
-- NOT carried here — it uses ephemeral Realtime broadcast instead.
-- =============================================================================

do $$
declare
  t text;
  tbls text[] := array[
    'chat_messages','board_objects','board_pages','timer_state',
    'room_members','documents','annotations','rooms'
  ];
begin
  foreach t in array tbls loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_object then null;   -- publication missing (self-hosted)
    end;
  end loop;
end $$;

-- Full row images so UPDATE/DELETE payloads carry every column the client needs.
alter table public.chat_messages  replica identity full;
alter table public.board_objects  replica identity full;
alter table public.board_pages    replica identity full;
alter table public.timer_state    replica identity full;
alter table public.room_members   replica identity full;
alter table public.documents      replica identity full;
alter table public.annotations    replica identity full;
alter table public.rooms          replica identity full;
