-- A skill becomes a multi-turn procedure (tm 296.2 · SiyahTuş analysis AI-03 ·
-- ADR-14a `docs/adr/skill-procedure.md`).
--
-- "Param yatmadı" is not answered in one message: the AI asks for the method
-- and the time, compares them with the method's expected time, then explains
-- the wait or asks for the receipt, and either settles it or hands it to
-- finance. ADR-14a keeps that a Skill — no new concept, no canvas — with
-- `mode = 'procedure'`. `mode = 'single'` is today's one-message step list and
-- the default, so every existing skill keeps working without a data move.
--
-- The columns, all defaulted or nullable:
--
--   - `mode`             — `single` | `procedure` (`skills_mode_check`).
--   - `when_to_use`, `examples`, `priority` — what the understanding call
--                          (AI-05, #297) selects a skill by, in either mode.
--                          Priority 1..1000, smaller wins
--                          (`PROCEDURE_PRIORITY_MIN`/`MAX`, @siyahtus/types).
--   - `slots`            — the procedure's `SlotDef`s (AI-04).
--   - `procedure`        — the rest of the definition: `{steps, templates,
--                          handoff, limits}`. Null on a `single` skill;
--                          `skills_procedure_mode_check` keeps a procedure
--                          skill from having none. The API validates it with
--                          `validateProcedure` before it is stored.
--   - `locked`, `template_key`, `template_version` — an installed template copy
--                          (AI-15, #311). Written by the server only: no client
--                          body names them.
--   - `is_fallback`      — the skill that answers when no other matches
--                          (AI-05, #297, which also moves the old skills onto it).
--
-- No `status` / `version` column (ADR `ai-config-versioning.md` §2.12): `active`
-- is "on in this version", and a template copy's draft is `active = false`.
--
-- Expand-only (CONVENTIONS §6.3): the previous release neither reads nor
-- writes any of these, and every row it inserts takes the defaults, which
-- satisfy both CHECKs. No RLS or grant change: `skills` keeps its tenant policy
-- and the runtime role's grants, which new columns inherit.

ALTER TABLE skills
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'single',
  ADD COLUMN when_to_use TEXT,
  ADD COLUMN examples TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN priority INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN slots JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN procedure JSONB,
  ADD COLUMN locked BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN template_key TEXT,
  ADD COLUMN template_version INTEGER,
  ADD COLUMN is_fallback BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE skills
  ADD CONSTRAINT skills_mode_check CHECK (mode IN ('single', 'procedure')),
  ADD CONSTRAINT skills_priority_check CHECK (priority BETWEEN 1 AND 1000),
  ADD CONSTRAINT skills_procedure_mode_check CHECK (mode = 'single' OR procedure IS NOT NULL);
