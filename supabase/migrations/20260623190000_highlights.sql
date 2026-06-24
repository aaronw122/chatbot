-- Branch-anchored highlights (Google-Docs-style comment marks).
--
-- A highlight anchors a follow-up "branch" conversation to a span of an
-- assistant message's rendered plain text. The anchor is text offsets
-- (start_offset, end_offset) into the message's rendered text — robust because
-- assistant messages are immutable. `quote` stores the highlighted substring for
-- model context + tooltip/fallback only (never for anchoring).
--
-- Cascade semantics (plan decision #5):
--   - message_id ... on delete cascade  → regenerating/deleting the source
--     message removes its highlight rows (marks vanish cleanly). The branch
--     conversation survives (separate conversations row).
--   - branch_convo_id ... on delete cascade → deleting the branch removes its
--     highlight.

create table if not exists highlights (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  branch_convo_id uuid not null references conversations(id) on delete cascade,
  start_offset int not null,
  end_offset int not null,
  quote text not null,
  user_id text,
  created_at timestamptz not null default now(),
  check (end_offset > start_offset)
);

create index if not exists idx_highlights_message_id on highlights(message_id);
create index if not exists idx_highlights_branch_convo_id on highlights(branch_convo_id);

-- RLS (backend service_role + better-auth/postgres both bypass; see memory).
-- Enabling RLS denies the public PostgREST roles (anon/authenticated) by default.
alter table highlights enable row level security;
