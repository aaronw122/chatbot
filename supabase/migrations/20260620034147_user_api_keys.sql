-- Phase 1: BYOK — per-user, encrypted-at-rest API keys (OpenAI + Anthropic).
-- One row per (user_id, provider). A single is_active provider per user is
-- enforced by the storage layer (it clears other rows on activate); there is
-- intentionally no DB-level "only one active per user" constraint.
-- Note: user_id is TEXT to match better-auth ids, consistent with conversations/messages.

create table if not exists user_api_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  provider      text not null check (provider in ('openai','anthropic')),
  encrypted_key text not null,       -- base64(iv).base64(authTag).base64(ciphertext)
  model         text not null,
  is_active     boolean not null default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (user_id, provider)
);

create index if not exists idx_user_api_keys_user_id on user_api_keys(user_id);
