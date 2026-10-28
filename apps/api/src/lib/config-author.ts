/**
 * Who a request's AI configuration change is by (tm 315 · AI-21): the
 * request's audit context and the member's role at this moment — the role is
 * kept on the change row, since it can change later. A bot or a token that is
 * no one's has no role.
 *
 * And which draft revision the change was made against (tm 316.2 · AI-20 ·
 * ADR-14b §2.5): the `If-Match` header, the revision the editor loaded. The
 * config-draft helper moves the revision only from that one, so the second of
 * two people saving over the same draft gets `409 ai_config_revision_conflict`
 * instead of overwriting the first.
 */
import type { FastifyRequest } from 'fastify';
import { ApiError } from './api-error.js';
import type { ConfigChangeAuthor } from '../services/ai/config-history.js';

export function configAuthorOf(request: FastifyRequest): ConfigChangeAuthor {
  const principal = request.principal;
  return {
    audit: request.auditContext(),
    role: principal?.kind === 'agent' ? principal.role : null,
    expectedRevision: draftRevisionOf(request.headers['if-match']),
  };
}

/**
 * The draft revision an `If-Match` names: `"12"`, `W/"12"` or `12` — the
 * revision the server sent as the draft's `ETag`. No header, or `*` (any
 * revision), is no condition. Anything else is refused rather than ignored: a
 * client that meant a condition must not get a save without one.
 */
export function draftRevisionOf(header: string | string[] | undefined): bigint | null {
  if (header === undefined) return null;
  const value = (Array.isArray(header) ? header.join(',') : header).trim();
  if (value === '' || value === '*') return null;
  const match = /^(?:W\/)?(?:"(\d{1,18})"|(\d{1,18}))$/.exec(value);
  const digits = match?.[1] ?? match?.[2];
  if (!digits) {
    throw ApiError.validation('If-Match: name one draft revision, as the draft’s ETag gives it.', {
      problems: [{ field: 'If-Match', code: 'invalid' }],
    });
  }
  return BigInt(digits);
}
