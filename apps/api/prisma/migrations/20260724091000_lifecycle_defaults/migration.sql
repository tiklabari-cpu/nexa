-- Align the two new tables with how every other model in this schema generates
-- ids: in the application, via Prisma's `@default(uuid())`.
--
-- The previous migration also gave the columns a database-side
-- `gen_random_uuid()` default. Both work, but having two sources of ids is the
-- kind of difference that shows up years later as "why is this one v4 and that
-- one not", and `prisma migrate diff` reports it as drift every run — which
-- trains people to ignore the drift check.
ALTER TABLE password_reset_tokens ALTER COLUMN id DROP DEFAULT;
ALTER TABLE invitations           ALTER COLUMN id DROP DEFAULT;
