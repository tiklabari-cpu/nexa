/**
 * Whether an event's attachment went through a virus scanner that looks for
 * malware (tm 433 · F21 · NY-51).
 *
 * The server writes `properties.scanned` on every event that carries an
 * `attachment_url`, and strips a caller-supplied one — a client cannot vouch
 * for its own file. `false` while the deployment's scanner does not search the
 * bytes (today's only one, the mock, refuses just the EICAR test file); the
 * agent panel then labels the attachment "Not checked for viruses".
 */
export const ATTACHMENT_SCANNED_PROPERTY = 'scanned';

/** `true`/`false` as the server stamped it; `null` for an event that predates the stamp. */
export function readAttachmentScanned(
  properties: Readonly<Record<string, unknown>> | null | undefined,
): boolean | null {
  const value = properties?.[ATTACHMENT_SCANNED_PROPERTY];
  return typeof value === 'boolean' ? value : null;
}
