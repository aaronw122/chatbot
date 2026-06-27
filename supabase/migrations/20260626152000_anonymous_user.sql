-- Anonymous-first free tier: the better-auth `anonymous` plugin registers an
-- `isAnonymous` field on the user model. better-auth uses its own pg Pool
-- (DATABASE_URL) and does NOT auto-migrate at runtime, so the column must be added
-- explicitly. The default better-auth adapter maps field names to columns verbatim
-- (camelCase) — the existing columns are `emailVerified`, `createdAt`, etc. — so the
-- column is `"isAnonymous"`, not `is_anonymous`.
--
-- The better-auth tables (account, session, "user", verification) are created by
-- better-auth itself, not by repo SQL (see 20260623183443_auth_row_level_security.sql).
-- So this is guarded with to_regclass: a no-op on a fresh database where better-auth
-- has not yet booted. Re-run after better-auth's first boot if it was skipped.
--
-- `default false` backfills every existing user as non-anonymous; `if not exists`
-- makes the migration idempotent and tolerant of a column better-auth may already
-- have created on a database where `better-auth migrate` was run first.

do $$
begin
  if to_regclass('public."user"') is not null then
    execute 'alter table public."user" add column if not exists "isAnonymous" boolean default false';
  else
    raise notice 'skipping isAnonymous: public."user" table does not exist yet';
  end if;
end $$;
