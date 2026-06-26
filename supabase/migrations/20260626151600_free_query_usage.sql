-- Free tier (owner-funded trial): per-user count of free AI replies consumed.
-- A signed-in user with no BYOK key gets FREE_TIER_LIMIT free replies funded by
-- the owner's key, then is gated to add their own key. Usage is per-user and
-- independent of whether/which provider key exists, so it lives in its own table
-- (not a column on user_api_keys).

create table if not exists free_query_usage (
  user_id    text primary key,
  used       integer not null default 0,
  updated_at timestamptz default now()
);

-- Enable + force RLS to match the same-day migration 20260623183127_row_level_security.sql,
-- which enables and forces RLS on every public table (see the [[supabase-rls]] memory).
-- No policies are needed: the backend uses the service-role key (bypasses RLS), exactly
-- like every other table.
alter table free_query_usage enable row level security;
alter table free_query_usage force row level security;

-- Atomic increment RPC. This cannot be expressed via the supabase-js / PostgREST client
-- (.upsert() can't reference a column self-value like `used = used + 1`), so the Supabase
-- storage impl calls this function via supabaseAdmin.rpc('increment_free_usage', ...).
-- Returns the new count.
-- NOTE: do NOT grant these RPCs to the anon/authenticated roles — the backend calls them
-- via the service-role key only.
create or replace function increment_free_usage(p_user_id text)
returns integer language sql
set search_path = public
as $$
  insert into free_query_usage (user_id, used) values (p_user_id, 1)
  on conflict (user_id) do update
    set used = free_query_usage.used + 1, updated_at = now()
  returning used;
$$;

-- Atomic decrement RPC to release a reservation (reserve-before-call refund path, see §4/§5).
-- Guards against going below 0. Service-role key only — do NOT grant to anon/authenticated.
create or replace function decrement_free_usage(p_user_id text)
returns integer language sql
set search_path = public
as $$
  update free_query_usage
    set used = greatest(free_query_usage.used - 1, 0), updated_at = now()
    where user_id = p_user_id
  returning used;
$$;
