-- Baseline security posture: enable Row-Level Security on the application tables.
--
-- Supabase publishes every table in the `public` schema through the auto-generated
-- PostgREST API. RLS is what scopes that API, so we enable it on all app tables as
-- standard practice.
--
-- No policies are defined on purpose: this app has no direct browser->Supabase
-- access. The backend data layer connects with SUPABASE_SECRET_KEY (service_role),
-- which bypasses RLS, so it retains full access. The public API roles
-- (anon/authenticated) have no policies and are therefore denied by default.

alter table conversations enable row level security;
alter table messages       enable row level security;
alter table user_api_keys  enable row level security;

-- force RLS so the table owner is subject to it as well (defense in depth). The
-- service_role / postgres connections bypass RLS at the role level, so app access
-- is unaffected.
alter table conversations force row level security;
alter table messages       force row level security;
alter table user_api_keys  force row level security;
