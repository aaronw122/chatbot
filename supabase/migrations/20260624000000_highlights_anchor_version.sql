-- Anchor coordinate-version tag for branch-anchored highlights (B2).
--
-- A highlight's (start_offset, end_offset) are indices into a specific
-- coordinate space, and that space is changing between renderer generations.
-- `anchor_version` records WHICH space a row's offsets belong to so the frontend
-- never reinterprets coordinates captured under a different scheme:
--   - Version 1: the pre-renderer all-text-node DOM coordinate space (bare
--     react-markdown text-node concatenation, document order).
--   - Version 2: the semantic canonical-text coordinate stream introduced with
--     the v2 renderer (buildAnchorModel — code/math-aware leaf concatenation).
--
-- Backfill semantics: every row that existed BEFORE this column becomes version
-- 1 (the default), because all pre-existing highlights were captured in the v1
-- space. New v2 captures store 2 explicitly. Unknown/future versions (anything
-- the running frontend does not understand) are preserved as-is and never
-- reinterpreted — under a newer scheme an older anchor renders as an unresolved
-- fallback rather than a silently mis-placed mark.
alter table highlights
  add column anchor_version int not null default 1
    check (anchor_version >= 1);
