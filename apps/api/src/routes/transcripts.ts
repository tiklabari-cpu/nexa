/**
 * A connection's transcript, on demand (AR-04 · tm 338): the download (plain
 * text or a printable page) and the mail of the player's copy. The decisions —
 * who may, which copy, which recipient — are `services/chat/transcript-export.ts`;
 * here they are put in order: the row, the budget, the reach, the audit entry,
 * then the bytes.
 */
import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TRANSCRIPT_AUDIENCES, TRANSCRIPT_EXPORT_FORMATS, isShortId } from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { requestLocale } from '../lib/request-locale.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import {
  TRANSCRIPT_CONTENT_TYPES,
  openTranscript,
  readTranscriptAllowedDomains,
  readTranscriptHeader,
  requireTranscriptExportReach,
  requireTranscriptExportRow,
  spendTranscriptExport,
  transcriptFile,
  transcriptFileName,
  transcriptLines,
  transcriptRecipient,
} from '../services/chat/transcript-export.js';
import { logUnsentMail } from '../services/mail/delivery.js';
import { isMailLocale } from '../services/mail/templates/layout.js';
import {
  renderTranscript,
  type TranscriptLine,
} from '../services/notifications/chat-transcript.js';

const chatIdSchema = z.string().refine(isShortId, 'not a valid chat id');
const threadIdSchema = z.string().min(1).max(64);
const downloadQuery = z.object({
  format: z.enum(TRANSCRIPT_EXPORT_FORMATS).default('txt'),
  audience: z.enum(TRANSCRIPT_AUDIENCES).default('customer'),
});
const emailBody = z
  .object({
    to: z.string().trim().email().max(254).optional(),
    audience: z.literal('customer').default('customer'),
  })
  .strict();

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
      { fields: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
    );
  }
  return result.data;
}

export default async function transcriptRoutes(app: FastifyInstance): Promise<void> {
  // --- GET /chats/:chatId/threads/:threadId/transcript -------------------------
  // The file: `txt`, or `html` the panel's print page shows and the browser
  // saves as a PDF. Audited before the first byte, so a download cut short is
  // on the record as asked for.

  app.get<{ Params: { chatId: string; threadId: string } }>(
    '/chats/:chatId/threads/:threadId/transcript',
    {
      config: {
        scopes: ['chats--all:ro', 'chats--access:ro'],
        principals: ['agent'],
      },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const threadId = parse(threadIdSchema, request.params.threadId);
      const { format, audience } = parse(downloadQuery, request.query);
      const principal = request.requirePrincipal();
      // Before the chat is read: the refusal says nothing about whether it exists.
      requireTranscriptExportRow(principal);
      await spendTranscriptExport(app.rateLimiter, principal, (error) =>
        request.log.error({ err: error, bucket: 'transcript' }, 'budget unavailable — allowing'),
      );
      const tenant = request.tenant();
      const locale = requestLocale(request);

      const { scope, header } = await request.withTenant(async (tx) => {
        const scope = await openTranscript(tx, principal, chatId, threadId);
        requireTranscriptExportReach(scope);
        const header = await readTranscriptHeader(tx, principal, scope, {
          audience,
          locale,
          organizationId: tenant.organizationId,
          now: new Date(),
        });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'chat.transcript_exported',
          target: `chat:${scope.chatId}`,
          metadata: { thread_id: scope.threadId, format, audience },
        });
        return { scope, header };
      });

      const pages = transcriptLines((fn) => request.withTenant(fn), scope, audience);
      return reply
        .header('content-type', TRANSCRIPT_CONTENT_TYPES[format])
        .header(
          'content-disposition',
          `attachment; filename="${transcriptFileName(scope, header, format)}"`,
        )
        .header('cache-control', 'no-store')
        .send(Readable.from(transcriptFile(format, header, pages, scope.customer.name)));
    },
  );

  // --- POST /chats/:chatId/threads/:threadId/transcript/email ------------------
  // The player's copy, in the closing mail's template, to the player or an
  // allowed domain. 202 once handed to the background sender; the external
  // daily cap is the carrier's (`chat_transcript`).

  app.post<{ Params: { chatId: string; threadId: string } }>(
    '/chats/:chatId/threads/:threadId/transcript/email',
    {
      config: {
        scopes: ['chats--all:ro', 'chats--access:ro'],
        principals: ['agent'],
      },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const threadId = parse(threadIdSchema, request.params.threadId);
      const body = parse(emailBody, request.body ?? {});
      const principal = request.requirePrincipal();
      await spendTranscriptExport(app.rateLimiter, principal, (error) =>
        request.log.error({ err: error, bucket: 'transcript' }, 'budget unavailable — allowing'),
      );
      const tenant = request.tenant();

      const { scope, recipient, frame } = await request.withTenant(async (tx) => {
        const scope = await openTranscript(tx, principal, chatId, threadId);
        const allowed = await readTranscriptAllowedDomains(tx, scope.brandId);
        const recipient = transcriptRecipient(principal, scope, body.to, allowed);
        const organization = await tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { name: true, timezone: true },
        });
        return {
          scope,
          recipient,
          frame: {
            workspaceName: organization?.name ?? 'SiyahTuş',
            timeZone: organization?.timezone ?? 'UTC',
          },
        };
      });

      const lines: TranscriptLine[] = [];
      for await (const page of transcriptLines((fn) => request.withTenant(fn), scope, 'customer')) {
        lines.push(...page);
      }
      // The player reads it in their widget's language, as the closing mail;
      // a colleague at an allowed domain in the sender's.
      const locale = recipient.toPlayer
        ? isMailLocale(scope.customer.locale)
          ? scope.customer.locale
          : 'en'
        : requestLocale(request);
      const content = renderTranscript({
        audience: 'customer',
        chatId: scope.chatId,
        customerName: scope.customer.name,
        lines,
        frame: { ...frame, locale },
      });
      if (content === null) {
        throw ApiError.validation('This connection has no messages to send.', {
          reason: 'empty_transcript',
        });
      }

      await request.withTenant((tx) =>
        writeAuditEntry(tx, request.auditContext(), {
          action: 'chat.transcript_emailed',
          target: `chat:${scope.chatId}`,
          metadata: {
            thread_id: scope.threadId,
            audience: 'customer',
            recipient_domain: recipient.domain,
            to_player: recipient.toPlayer,
          },
        }),
      );
      app.backgroundMail.send(
        { to: recipient.to, licenseId: tenant.licenseId, kind: 'chat_transcript', ...content },
        (outcome) => logUnsentMail(app.log, 'chat.transcript_mail', outcome),
      );
      return reply.code(202).send({ accepted: true });
    },
  );
}
