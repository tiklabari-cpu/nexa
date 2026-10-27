/**
 * Attachment uploads.
 *
 * Four endpoints, and the split between them is the point:
 *
 *   POST /uploads            asks permission — this is where the file-sharing
 *                            rules are enforced, before a single byte moves
 *   GET  /uploads-policy     just the on/off switch, for a composer deciding
 *                            whether to offer the affordance at all
 *   PUT  /uploads/:key       receives the bytes, authorised by the signature
 *                            the POST issued rather than by a session
 *   GET  /uploads/:key       serves them back, authorised by a session whose
 *                            licence has to match the one inside the key
 *
 * and a fifth for the one kind of upload `GET /uploads/:key` never serves back
 * — a PDF or Word document for the knowledge base (`purpose:
 * knowledge_document`, tm 313 · AI-18):
 *
 *   GET  /knowledge-files/:key  its original, authorised by a short-lived link
 *                               `GET /knowledge-sources/:id/file` signed
 *
 * `/uploads-policy` sits outside the `/uploads/:key` family on purpose, not
 * nested under it: `scripts/audit/endpoint-ui.cjs`'s path matcher for a
 * parametric route matches any single segment in that position, so a nested
 * `/uploads/policy` would read as a call to `/uploads/:key` as well as to
 * itself and desync that operation's own UI-coverage entry.
 *
 * The rules come from `security_settings` (FR-MOD-08.9.4), the same row the
 * Settings screen writes. An admin who narrows the list narrows what the
 * composer can send in the same breath, because there is one source for both.
 *
 * The GET is deliberately *not* signed. `attachment_url` is stored on the event
 * and read months later; a signature there would either expire — leaving old
 * conversations full of broken images — or have to be minted with a TTL long
 * enough to be meaningless. A session plus the licence prefix is both stronger
 * and honest about its lifetime.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KNOWLEDGE_DOCUMENT_LIMITS,
  KNOWLEDGE_DOCUMENT_MIME_TYPES,
  UPLOAD_PURPOSES,
  hasAnyScope,
  normalizeKnowledgeDocumentMime,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { Env } from '../config/env.js';
import { identifyKnowledgeDocument } from '../services/ai/knowledge-document-type.js';
import { createObjectStore, digestBytes } from '../services/storage/object-store.js';
import {
  KnowledgeDownloadSigner,
  UploadSigner,
  buildKey,
  buildKnowledgeKey,
  licenseOfKey,
  licenseOfKnowledgeKey,
} from '../services/storage/upload-url.js';
import { assertClean, createVirusScanner } from '../services/storage/virus-scanner.js';

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

const requestBody = z.object({
  filename: z.string().min(1).max(255).optional(),
  content_type: z.string().min(3).max(255).regex(MIME, 'must be a MIME type'),
  size_bytes: z.number().int().positive(),
  purpose: z.enum(UPLOAD_PURPOSES).default('attachment'),
});

/** What an attachment needs: the conversation scopes, as before tm 313. */
const ATTACHMENT_SCOPES = ['chats--all:rw', 'chats--access:rw'];
/** What a knowledge document needs: the knowledge editor's (`routes/playbook.ts` `WRITE`). */
const KNOWLEDGE_SCOPES = ['agents-bot--all:rw'];

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

/** Mirrors `model SecuritySettings` in schema.prisma; see settings.ts. */
const DEFAULTS = {
  fileSharingEnabled: true,
  allowedFileTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  maxFileSizeBytes: 10_485_760,
};

interface Options {
  env: Env;
}

export default async function uploadRoutes(app: FastifyInstance, { env }: Options): Promise<void> {
  const signer = new UploadSigner(env.UPLOAD_SIGNING_KEY);
  const downloads = new KnowledgeDownloadSigner(env.UPLOAD_SIGNING_KEY);
  const store = createObjectStore(env.STORAGE_PROVIDER, env.storage);
  const scanner = createVirusScanner(env.VIRUS_SCANNER);

  /**
   * The PUT ceiling.
   *
   * Per-route, so the 1 MiB `bodyLimit` every other route inherits stays where
   * `server.ts` put it. This is a hard cap on what the process will buffer at
   * all; the licence's own `max_file_size_bytes` is enforced above it and can
   * only ever be stricter.
   */
  const HARD_CEILING = 26_214_400; // 25 MiB

  // Fastify parses JSON and text out of the box and rejects everything else.
  // Encapsulation keeps this catch-all inside this plugin: no other route
  // starts accepting arbitrary bytes because uploads needed to.
  app.addContentTypeParser(
    '*',
    { parseAs: 'buffer', bodyLimit: HARD_CEILING },
    (_req, body, done) => done(null, body),
  );

  app.post(
    '/uploads',
    {
      // Either purpose's scopes let the request in; the handler then holds
      // each purpose to its own — an attachment to the conversation scopes, a
      // knowledge document to the knowledge editor's.
      config: {
        scopes: [...ATTACHMENT_SCOPES, ...KNOWLEDGE_SCOPES],
        principals: ['agent', 'customer'],
      },
    },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      const body = parse(requestBody, request.body);

      if (body.purpose === 'knowledge_document') {
        // A member editing the knowledge base, never a visitor: the route's
        // principal list lets a customer in for attachments only.
        if (principal.kind !== 'agent' || !hasAnyScope(principal.scopes, KNOWLEDGE_SCOPES)) {
          throw ApiError.authorization(
            `Uploading a knowledge document needs the ${KNOWLEDGE_SCOPES.join(', ')} scope.`,
          );
        }
        return reply.status(201).send(grantKnowledgeDocument(principal.licenseId, body));
      }
      // A customer token has no scopes by design (its principal kind is its
      // authorisation, as in the auth plugin); a member needs a conversation
      // scope, which the route's wider list no longer guarantees.
      if (principal.kind !== 'customer' && !hasAnyScope(principal.scopes, ATTACHMENT_SCOPES)) {
        throw ApiError.authorization(
          `This token is missing the required scope (one of: ${ATTACHMENT_SCOPES.join(', ')}).`,
        );
      }
      const contentType = body.content_type.toLowerCase();

      const row = await request.withTenant((tx) => tx.securitySettings.findFirst());
      const rules = {
        fileSharingEnabled: row?.fileSharingEnabled ?? DEFAULTS.fileSharingEnabled,
        allowedFileTypes: row?.allowedFileTypes ?? DEFAULTS.allowedFileTypes,
        maxFileSizeBytes: row?.maxFileSizeBytes ?? DEFAULTS.maxFileSizeBytes,
      };

      // Refusals happen here, before a URL exists. A grant this endpoint never
      // issues is a file that can never be stored — which is why the checks
      // live at the permission step rather than only at the PUT.
      if (!rules.fileSharingEnabled) {
        throw ApiError.authorization('File sharing is turned off for this licence.');
      }
      if (!rules.allowedFileTypes.map((t) => t.toLowerCase()).includes(contentType)) {
        throw ApiError.validation(`Files of type ${contentType} are not allowed.`, {
          allowed_file_types: rules.allowedFileTypes,
        });
      }
      if (body.size_bytes > rules.maxFileSizeBytes) {
        throw ApiError.validation('File is larger than this licence allows.', {
          max_file_size_bytes: rules.maxFileSizeBytes,
        });
      }

      const key = buildKey(principal.licenseId, contentType);
      const expiresAt = Math.floor(Date.now() / 1000) + env.UPLOAD_URL_TTL;
      const signature = signer.sign({ key, contentType, sizeBytes: body.size_bytes, expiresAt });

      const query = new URLSearchParams({
        content_type: contentType,
        size_bytes: String(body.size_bytes),
        expires_at: String(expiresAt),
        signature,
      });

      return reply.status(201).send({
        upload_url: `/api/v1/uploads/${key}?${query.toString()}`,
        upload_id: key,
        file_url: `/api/v1/uploads/${key}`,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      });
    },
  );

  /**
   * A grant for a knowledge document (tm 313 · AI-18). The conversation's
   * file-sharing rules are not consulted — they decide what a chat may carry
   * — so the type and the size are the document rules: PDF or DOCX, at most
   * `KNOWLEDGE_DOCUMENT_LIMITS.maxBytes`. The key is one `GET /uploads/:key`
   * refuses, and the grant names no `file_url` for the same reason.
   */
  function grantKnowledgeDocument(
    licenseId: bigint,
    body: { content_type: string; size_bytes: number },
  ): Record<string, unknown> {
    const contentType = normalizeKnowledgeDocumentMime(body.content_type);
    if (contentType === null) {
      throw ApiError.validation('A knowledge document must be a PDF or a Word (.docx) file.', {
        reason: 'unsupported_type',
        allowed_types: KNOWLEDGE_DOCUMENT_MIME_TYPES,
      });
    }
    if (body.size_bytes > KNOWLEDGE_DOCUMENT_LIMITS.maxBytes) {
      throw ApiError.validation('A knowledge document may be at most 20 MiB.', {
        reason: 'file_too_large',
        max_bytes: KNOWLEDGE_DOCUMENT_LIMITS.maxBytes,
      });
    }
    const key = buildKnowledgeKey(licenseId, contentType);
    const expiresAt = Math.floor(Date.now() / 1000) + env.UPLOAD_URL_TTL;
    const signature = signer.sign({ key, contentType, sizeBytes: body.size_bytes, expiresAt });
    const query = new URLSearchParams({
      content_type: contentType,
      size_bytes: String(body.size_bytes),
      expires_at: String(expiresAt),
      signature,
    });
    return {
      upload_url: `/api/v1/uploads/${key}?${query.toString()}`,
      upload_id: key,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    };
  }

  app.get(
    '/uploads-policy',
    // Every agent role reaches this (`chats--access:rw` is in
    // `DEFAULT_AGENT_SCOPES`), unlike `GET /settings/security`
    // (`access_rules:ro`, admin-only) — the composer needs the on/off switch
    // to decide whether to show the attachment button at all, not the full
    // rule set behind it.
    { config: { scopes: ['chats--all:rw', 'chats--access:rw'], principals: ['agent'] } },
    async (request) => {
      const row = await request.withTenant((tx) =>
        tx.securitySettings.findFirst({ select: { fileSharingEnabled: true } }),
      );
      return { file_sharing_enabled: row?.fileSharingEnabled ?? DEFAULTS.fileSharingEnabled };
    },
  );

  app.put<{ Params: { key: string } }>(
    '/uploads/:key',
    // No principal: the signature *is* the authorisation, and it is narrower
    // than a session — one key, one type, one length, one short window.
    { config: { public: true }, bodyLimit: HARD_CEILING },
    async (request, reply) => {
      const key = request.params.key;
      const query = request.query as Record<string, string | undefined>;
      const bytes = Buffer.isBuffer(request.body) ? request.body : null;
      if (!bytes) throw ApiError.validation('Expected the file as a binary body.');

      const verdict = signer.verify(
        {
          key,
          contentType: query.content_type,
          sizeBytes: Number(query.size_bytes),
          expiresAt: Number(query.expires_at),
          signature: query.signature,
        },
        { contentType: query.content_type ?? '', sizeBytes: bytes.byteLength },
      );

      if (!verdict.ok) {
        // One message for every rejection. Telling a caller *which* part of
        // their forgery failed is how a forgery gets refined.
        throw ApiError.authorization('This upload URL is not valid.');
      }

      // Scan before a single byte lands on disk: a stored file is therefore
      // always one that passed, so the GET can never serve an unscanned file
      // (FR-MOD-08.9.4). Fail closed — an unreachable scanner refuses the upload.
      await assertClean(scanner, bytes);

      // A knowledge document's type is read from its bytes, and they must be
      // the type the grant vetted: a renamed executable or a `.docm` stops
      // here, with nothing stored (tm 313 · AI-18).
      const document = licenseOfKnowledgeKey(verdict.grant.key) !== null;
      if (document) {
        const read = identifyKnowledgeDocument(bytes);
        if (!read.ok || read.mime !== verdict.grant.contentType) {
          request.log.info(
            { why: read.ok ? 'type_mismatch' : read.why },
            'knowledge document refused by type',
          );
          throw ApiError.validation('This file is not a PDF or a Word (.docx) document.', {
            reason: 'unsupported_type',
          });
        }
      }

      await store.put(verdict.grant.key, bytes, verdict.grant.contentType);
      return reply.status(201).send({
        upload_id: verdict.grant.key,
        ...(document ? {} : { file_url: `/api/v1/uploads/${verdict.grant.key}` }),
        size_bytes: bytes.byteLength,
        checksum_sha256: digestBytes(bytes),
      });
    },
  );

  app.get<{ Params: { key: string } }>(
    '/uploads/:key',
    {
      config: {
        scopes: ['chats--all:ro', 'chats--access:ro', 'chats--all:rw', 'chats--access:rw'],
        principals: ['agent', 'customer'],
      },
    },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      const key = request.params.key;
      const owner = licenseOfKey(key);

      // The whole cross-tenant story, in one comparison. `notFound` rather than
      // `authorization`: whether another licence's file exists is not something
      // this caller gets to learn.
      if (owner === null || owner !== principal.licenseId) {
        throw ApiError.notFound('Resource not found.');
      }

      const file = await store.get(key);
      if (!file) throw ApiError.notFound('Resource not found.');

      return (
        reply
          .header('content-type', file.contentType)
          // Never inline: an allowed text/plain rendered in our own origin is a
          // stored-XSS surface handed over for free.
          .header('content-disposition', 'attachment')
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'private, max-age=31536000, immutable')
          .send(file.bytes)
      );
    },
  );

  app.get<{ Params: { key: string } }>(
    '/knowledge-files/:key',
    // No principal: the link's signature is the authorisation — one document,
    // one filename, five minutes — minted by `GET /knowledge-sources/:id/file`
    // for a member allowed to read the source.
    { config: { public: true } },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const grant = downloads.verify({
        key: request.params.key,
        filename: query.filename,
        expiresAt: Number(query.expires_at),
        signature: query.signature,
      });
      // One answer for every refusal, as for a forged upload URL.
      if (!grant) throw ApiError.authorization('This download link is not valid.');

      const file = await store.get(grant.key);
      if (!file) throw ApiError.notFound('Resource not found.');

      return (
        reply
          .header('content-type', file.contentType)
          .header('content-disposition', contentDisposition(grant.filename))
          .header('x-content-type-options', 'nosniff')
          // A workspace's terms and procedures are not left in a shared cache.
          .header('cache-control', 'no-store')
          .send(file.bytes)
      );
    },
  );
}

/**
 * `attachment` with the name a person saves the file as: an ASCII fallback
 * (anything outside printable ASCII, a quote or a backslash becomes `_`) and
 * the exact name as RFC 5987 `filename*`. Never `inline`.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]|["\\]/g, '_') || 'document';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
