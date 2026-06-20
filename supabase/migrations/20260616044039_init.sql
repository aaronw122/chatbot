-- Phase 0: chat persistence schema (conversations + messages)
-- Note: user_id is TEXT to match better-auth's default user id type (random strings, NOT uuids).
-- If you reconfigure better-auth to emit uuids, change user_id to uuid.

create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    text not null,
  title      text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  save       boolean default true
);

create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  convo_id   uuid references conversations(id) on delete cascade,
  role       text not null,
  content    text not null,
  created_at timestamptz default now()
);

create index if not exists idx_conversations_user_id on conversations(user_id);
create index if not exists idx_messages_convo_id_created_at on messages(convo_id, created_at);
