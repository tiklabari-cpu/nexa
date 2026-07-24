/**
 * Inbound channels — the asynchronous door into the inbox (FR-MOD-08.5.3).
 *
 * Email is the first: a mail provider parses a forwarded message and posts it
 * here. The route is public because no session exists yet — the recipient
 * address *is* the credential, resolved to a licence the same SECURITY DEFINER
 * way the hosted Chat page resolves one (Dilim 9). Everything past that runs
 * inside `withTenant`, so RLS holds the write to the licence the address named.
 *
 * The provider is mocked in this build (PLAN A4); a real deployment signs the
 * webhook. `INBOUND_EMAIL_SECRET`, when set, stands in for that signature.
 */
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { withTenant } from '../lib/tenant.js';
import { TicketService } from '../services/tickets/ticket-service.js';
import {
  ingestInboundEmail,
  parseSender,
  recipientOrganizationId,
} from '../services/channels/email-inbound.js';

const inboundBody = z.object({
  to: z.string().min(1).max(320),
  from: z.string().min(1).max(320),
  subject: z.string().max(998).default(''),
  // Accepted so the shape matches what a parse webhook sends, but not stored:
  // the ticket core carries no body (see TicketService).
  text: z.string().max(100_000).optional(),
  spam: z.boolean().default(false),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** Constant-time compare, so a wrong secret cannot be guessed a byte at a time. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function channelRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;
  const tickets = new TicketService();

  app.post('/channels/email/inbound', { config: { public: true } }, async (request, reply) => {
    if (env.INBOUND_EMAIL_SECRET) {
      const header = request.headers['x-inbound-secret'];
      const provided = Array.isArray(header) ? header[0] : header;
      if (!secretMatches(provided, env.INBOUND_EMAIL_SECRET)) {
        throw ApiError.authentication('Invalid inbound webhook secret.');
      }
    }

    const body = parse(inboundBody, request.body);

    // Both are transport concerns, settled before any tenant context: the
    // recipient names the workspace, the sender names the customer.
    const organizationId = recipientOrganizationId(body.to);
    if (!organizationId) throw ApiError.notFound('Unknown recipient.');
    const sender = parseSender(body.from);
    if (!sender) throw ApiError.validation('from: a valid sender address is required.');

    const matches = await app.db.$queryRaw<
      Array<{ license_id: bigint; organization_id: string; license_status: string }>
    >(Prisma.sql`SELECT * FROM auth_resolve_organization_license(${organizationId}::uuid)`);

    const match = matches[0];
    // Absent, or a workspace that is closed: the address no longer accepts mail.
    // A 4xx tells the provider this is permanent, not something to retry.
    if (!match || match.license_status === 'canceled') {
      throw ApiError.notFound('Unknown recipient.');
    }

    const tenant = { licenseId: match.license_id, organizationId: match.organization_id };
    const result = await withTenant(app.db, tenant, (tx) =>
      ingestInboundEmail(tx, tenant, tickets, {
        senderEmail: sender.email,
        senderName: sender.name,
        subject: body.subject,
        spam: body.spam,
      }),
    );

    return reply.send(result);
  });
}
