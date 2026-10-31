-- The ticket first-response SLA (HD-05, tm 360).
--
--   sla_policies.ticket_first_response_minutes   a ticket's first-response
--       target. NULL: not measured. Apart from first_response_minutes (the
--       chat's) on purpose: applying that to tickets would have marked every
--       existing workspace's open queue as breached the day this shipped.
--   sla_policies.ticket_resolution_minutes   a ticket's resolution target.
--       NULL: resolution_minutes, which is what tickets were measured against
--       before this column existed — so nothing has to be copied across.
--   sla_policies.ticket_targets_by_priority   a priority's own targets,
--       {"urgent": {"first_response_minutes": 60, "resolution_minutes": null}, …}.
--   tickets.first_response_due_at   from when a first reply is late, while the
--       clock runs (no agent reply yet, open or pending, not merged, not opened
--       from a chat). NULL otherwise. Stored so the list can sort the whole
--       collection by it; the service and the SLA sweep keep it current.
--
-- Additive only: every column is nullable with no default, so the previous
-- release, which never writes them, is unaffected. Existing tickets start with
-- no due moment — no target exists yet to give them one.
ALTER TABLE sla_policies ADD COLUMN ticket_first_response_minutes INTEGER;
ALTER TABLE sla_policies ADD COLUMN ticket_resolution_minutes INTEGER;
ALTER TABLE sla_policies ADD COLUMN ticket_targets_by_priority JSONB;
ALTER TABLE tickets ADD COLUMN first_response_due_at TIMESTAMPTZ;

-- The same bounds as the chat targets (SLA_MAX_TARGET_MINUTES).
ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_ticket_first_response_minutes_check
    CHECK (ticket_first_response_minutes IS NULL
           OR (ticket_first_response_minutes > 0 AND ticket_first_response_minutes <= 129600));
ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_ticket_resolution_minutes_check
    CHECK (ticket_resolution_minutes IS NULL
           OR (ticket_resolution_minutes > 0 AND ticket_resolution_minutes <= 129600));
-- The shape of each entry is the service's to check; the column holds an object.
ALTER TABLE sla_policies
  ADD CONSTRAINT sla_policies_ticket_targets_by_priority_check
    CHECK (ticket_targets_by_priority IS NULL
           OR jsonb_typeof(ticket_targets_by_priority) = 'object');
