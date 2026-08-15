/**
 * SIEM export targets (NFR-C6 · C6-b).
 *
 * Where a workspace's audit trail is shipped to. Closed vocabulary, shared by
 * the settings surface, the database CHECK constraint and the screen, so an
 * unknown target cannot be saved from any of the three: a configured
 * destination nothing delivers to reads as "my log is shipping" while nothing
 * ships, which is the one failure mode a compliance feature must not have.
 *
 * One entry today. Splunk/Sentinel/Datadog connectors are a project boundary
 * (CLAUDE.md: external services are mocked), so `file` — the `.data/siem` sink
 * C6-d writes — is the whole of what this deployment can honestly offer.
 * Adding a real target later costs a migration, which is the right price for a
 * value the delivery job has to learn to speak.
 */
export const SIEM_EXPORT_TARGETS = ['file'] as const;

export type SiemExportTarget = (typeof SIEM_EXPORT_TARGETS)[number];

export function isSiemExportTarget(value: unknown): value is SiemExportTarget {
  return typeof value === 'string' && (SIEM_EXPORT_TARGETS as readonly string[]).includes(value);
}
