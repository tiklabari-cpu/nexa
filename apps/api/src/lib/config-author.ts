/**
 * Who a request's AI configuration change is by (tm 315 · AI-21): the
 * request's audit context and the member's role at this moment — the role is
 * kept on the change row, since it can change later. A bot or a token that is
 * no one's has no role.
 */
import type { FastifyRequest } from 'fastify';
import type { ConfigChangeAuthor } from '../services/ai/config-history.js';

export function configAuthorOf(request: FastifyRequest): ConfigChangeAuthor {
  const principal = request.principal;
  return {
    audit: request.auditContext(),
    role: principal?.kind === 'agent' ? principal.role : null,
  };
}
