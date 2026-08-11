/**
 * Attachment uploads.
 *
 * Three endpoints, and the split between them is the point:
 *
 *   POST /uploads            asks permission — this is where the file-sharing
 *                            rules are enforced, before a single byte moves
 *   PUT  /uploads/:key       receives the bytes, authorised by the signature
 *                            the POST issued rather than by a session
 *   GET  /uploads/:key       serves them back, authorised by a session whose
 *                            licence has to match the one inside the key
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
import { ApiError } from '../lib/api-error.js';
import type { Env } from '../config/env.js';
import { LocalStore } from '../services/storage/local-store.js';
import { UploadSigner, buildKey, licenseOfKey } from '../services/storage/upload-url.js';
import { assertClean, createVirusScanner } from '../services/storage/virus-scanner.js';

const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

const requestBody = z.object({
  filename: z.string().min(1).max(255).optional(),
  content_type: z.string().min(3).max(255).regex(MIME, 'must be a MIME type'),
  size_bytes: z.number().int().positive(),
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
  const store = new LocalStore(env.STORAGE_LOCAL_DIR);
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
      config: { scopes: ['chats--all:rw', 'chats--access:rw'], principals: ['agent', 'customer'] },
    },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      const body = parse(requestBody, request.body);
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
        file_url: `/api/v1/uploads/${key}`,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      });
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

      await store.put(verdict.grant.key, bytes, verdict.grant.contentType);
      return reply.status(201).send({
        file_url: `/api/v1/uploads/${verdict.grant.key}`,
        size_bytes: bytes.byteLength,
        checksum_sha256: LocalStore.digest(bytes),
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
}
