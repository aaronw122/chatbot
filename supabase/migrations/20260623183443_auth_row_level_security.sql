-- Baseline security posture (auth tables): enable RLS on the better-auth tables.
--
-- better-auth creates these tables (account, session, "user", verification) in the
-- public schema via its own pg Pool, so they are not defined by repo SQL. We enable
-- RLS on them for the same reason as the app tables: the public schema is published
-- through PostgREST, and RLS scopes that API.
--
-- No policies are needed: better-auth connects via DATABASE_URL as the `postgres`
-- role (bypasses RLS), so it retains full access. The public API roles
-- (anon/authenticated) are denied by default.
--
-- Guarded with to_regclass so this is a no-op on a fresh database where better-auth
-- has not yet created its tables. On a brand-new project, re-run after better-auth's
-- first boot so these tables pick up RLS.

do $$
declare
  t text;
  tables text[] := array['account', 'session', 'user', 'verification'];
begin
  foreach t in array tables loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('alter table public.%I force row level security', t);
    else
      raise notice 'skipping %: table does not exist yet', t;
    end if;
  end loop;
end $$;
