-- `tickets.subject` is required (PRD §8.4 lists it without a nullable marker,
-- and the create contract demands it).
--
-- The previous migration added a CHECK that rejects null and blank subjects,
-- which enforces the rule but leaves the column nullable in the DDL. That
-- mismatch is real, not cosmetic: the schema is the thing other tools read, and
-- a column documented as optional invites the next writer to omit it.
--
-- Safe to run unconditionally here because no write path has ever created a
-- ticket, so the table is empty.
ALTER TABLE tickets
  ALTER COLUMN subject SET NOT NULL;
