-- Saved replies (IN-06 · tm 363), step 4 of 4 — the narrowing step, on its own.
--
-- The licence-wide `(license_id, scope, shortcut)` unique index would refuse a
-- personal reply whose shortcut a shared one (or another agent's personal one)
-- already uses. Steps 2 and 3 carry its rule for the rows it is still meant for,
-- so dropping it loosens nothing a shared reply relied on: the previous release
-- only writes shared replies, and the shared partial index refuses its
-- duplicates exactly as this one did.
DROP INDEX IF EXISTS "canned_responses_license_id_scope_shortcut_key";
