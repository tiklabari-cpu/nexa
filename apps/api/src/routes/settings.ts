/**
 * Workspace settings.
 *
 * Everything here already existed in the schema and could previously only be
 * changed by editing the database. Trusted domains is the one that mattered
 * most: until a customer's domain is on this list the widget cannot mint a
 * token on their site, so the product shipped in a state nobody could deploy.
 */
import { isIP } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  DEFAULT_SALES_TRACKER_CONFIG,
  DEFAULT_WIDGET_APPEARANCE,
  EXPERTISE_NAME_MAX_LENGTH,
  SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS,
  SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS,
  SALES_TRACKER_CURRENCIES,
  WIDGET_COLOR_PATTERN,
  WIDGET_POSITIONS,
  WIDGET_THEMES,
} from '@nexa/types';
import type { SsoAttributeMappingKey, SsoConnection } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { normaliseIp } from '../lib/banned-ip.js';
import { resolveBrandId } from '../lib/brand.js';
import { formatAllowlistEntry, parseAllowlistEntry, wouldLockOut } from '../lib/ip-allowlist.js';
import { normaliseTrustedDomain } from '../lib/origin.js';
import {
  activePreviousCertificate,
  checkFederationUrl,
  inspectIdpCertificate,
  MAX_CERTIFICATE_OVERLAP_HOURS,
  MIN_RSA_MODULUS_BITS,
  readSsoAttributeMapping,
  SSO_CERTIFICATE_MAX_LENGTH,
  SSO_ENTITY_ID_MAX_LENGTH,
  SSO_NAME_MAX_LENGTH,
  SSO_URL_MAX_LENGTH,
  type CertificateFacts,
} from '../lib/sso-connection.js';
import { writeAuditEntry, type AuditEntry } from '../services/audit/audit-log.js';
import { MAX_ACTIVE_TOKENS_PER_OWNER } from '../services/auth/token-service.js';

const SHORTCUT = /^[A-Za-z0-9_-]{1,40}$/;

const addDomainBody = z.object({
  domain: z.string().trim().min(1).max(253),
  include_subdomains: z.boolean().default(false),
});

/**
 * One IP allow-list entry (FR-MOD-08.9.6). `entry` is validated against the same
 * parser the enforcement gate will use — `max(49)` fits the longest textual form
 * (a full IPv6 address plus `/128`); anything malformed is rejected in the handler
 * with the parser as the single source of truth, not re-derived here. `label` is an
 * optional human note; an empty string is a mistake, not a way to clear it.
 */
const addIpAllowlistBody = z.object({
  entry: z.string().trim().min(1).max(49),
  label: z.string().trim().min(1).max(100).nullable().optional(),
});

/**
 * The assertion attribute names a connection may map (NFR-S11 · S11-a2).
 *
 * `satisfies` rather than a hand-kept list: adding a key to
 * `SSO_ATTRIBUTE_MAPPING_KEYS` without adding it here stops the build, so the
 * write surface can never accept less than the type promises — or, with
 * `.strict()` below, more. Rejecting an unknown key rather than dropping it is
 * the point: a silently discarded mapping reads to an admin as a saved one.
 */
const SSO_ATTRIBUTE_BODY_SHAPE = {
  email: z.string().trim().min(1).max(255).optional(),
  name: z.string().trim().min(1).max(255).optional(),
} satisfies Record<SsoAttributeMappingKey, z.ZodTypeAny>;

const ssoAttributeMappingBody = z.object(SSO_ATTRIBUTE_BODY_SHAPE).strict();

/**
 * A pasted certificate, stored in the conventional PEM form: surrounding
 * whitespace gone, one trailing newline. Canonicalised rather than kept
 * verbatim so that what the API hands back can be written straight to a file,
 * and so re-saving a form does not rewrite the row with bytes that differ only
 * in whitespace. (Whether a save is a *rotation* is decided by fingerprint, not
 * by these bytes, so this normalisation cannot change that answer.)
 */
const ssoCertificate = z
  .string()
  .trim()
  .min(1)
  .max(SSO_CERTIFICATE_MAX_LENGTH)
  .transform((pem) => `${pem}\n`);

/**
 * A new SAML connection. Every field that decides whether an assertion is
 * believed is required — there is no half-configured trust anchor to save and
 * finish later, because a row missing one of these would sit in the list looking
 * like a federation. `enabled` still defaults to off: writing the configuration
 * and opening the door are two decisions.
 */
const createSsoBody = z.object({
  name: z.string().trim().min(1).max(SSO_NAME_MAX_LENGTH),
  idp_entity_id: z.string().trim().min(1).max(SSO_ENTITY_ID_MAX_LENGTH),
  idp_sso_url: z.string().trim().min(1).max(SSO_URL_MAX_LENGTH),
  idp_certificate_pem: ssoCertificate,
  attribute_mapping: ssoAttributeMappingBody.optional(),
  allow_idp_initiated: z.boolean().default(false),
  enabled: z.boolean().default(false),
});

/**
 * A change to an existing connection, including the two rotation controls.
 *
 * `retain_previous_certificate_hours` is the *only* way both certificates are
 * ever trusted at once, and it is meaningless without a new certificate to
 * rotate to — so it is refused on its own rather than quietly ignored.
 * `revoke_previous_certificate` closes an overlap early (the "we now know the
 * old key was compromised" case) and is refused alongside a new certificate,
 * where a plain rotation already decides the overlap's fate.
 */
const updateSsoBody = z
  .object({
    name: z.string().trim().min(1).max(SSO_NAME_MAX_LENGTH).optional(),
    idp_entity_id: z.string().trim().min(1).max(SSO_ENTITY_ID_MAX_LENGTH).optional(),
    idp_sso_url: z.string().trim().min(1).max(SSO_URL_MAX_LENGTH).optional(),
    idp_certificate_pem: ssoCertificate.optional(),
    attribute_mapping: ssoAttributeMappingBody.optional(),
    allow_idp_initiated: z.boolean().optional(),
    enabled: z.boolean().optional(),
    retain_previous_certificate_hours: z
      .number()
      .int()
      .min(1)
      .max(MAX_CERTIFICATE_OVERLAP_HOURS)
      .optional(),
    revoke_previous_certificate: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required')
  .refine(
    (body) =>
      body.retain_previous_certificate_hours === undefined ||
      body.idp_certificate_pem !== undefined,
    'retain_previous_certificate_hours only applies alongside a new idp_certificate_pem',
  )
  .refine(
    (body) => !(body.revoke_previous_certificate && body.idp_certificate_pem !== undefined),
    'revoke_previous_certificate cannot be combined with a new idp_certificate_pem — a rotation already decides what happens to the old one',
  );

const cannedListQuery = z.object({ scope: z.enum(['chat', 'ticket']).optional() });

const createCannedBody = z.object({
  shortcut: z.string().trim().regex(SHORTCUT, 'letters, digits, _ and - only, up to 40'),
  text: z.string().trim().min(1).max(10_000),
  scope: z.enum(['chat', 'ticket']).default('chat'),
});

const updateCannedBody = z
  .object({
    shortcut: z
      .string()
      .trim()
      .regex(SHORTCUT, 'letters, digits, _ and - only, up to 40')
      .optional(),
    text: z.string().trim().min(1).max(10_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/**
 * A rule's match/eligibility conditions. `expertise_ids` (FR-MOD-08.6.3) narrows
 * the agent pool to those holding every listed area; the url/country fields are
 * the existing team-match criteria. Sent whole — the object *replaces* the
 * rule's stored conditions — so a partial edit must resend the parts it keeps.
 */
const ruleConditionsBody = z.object({
  url_contains: z.array(z.string()).optional(),
  url_equals: z.array(z.string()).optional(),
  country_codes: z.array(z.string()).optional(),
  expertise_ids: z.array(z.coerce.bigint()).max(200).optional(),
});

const updateRuleBody = z
  .object({
    enabled: z.boolean().optional(),
    target_group_id: z.coerce.bigint().nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
    conditions: ruleConditionsBody.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/**
 * `type/subtype`, the shape a browser actually puts in `Content-Type`.
 *
 * Rejecting anything else is the point: `.pdf` or `pdf` would sit in the
 * allowlist looking like a rule while matching no upload ever labelled by a
 * browser, so file sharing would appear configured and block everything.
 */
const MIME = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** 100 MiB. Above this the signed-upload path (FR-MOD-08.9.4-b) is not viable. */
const MAX_FILE_SIZE_CEILING = 104_857_600;

/**
 * Mirrors the column defaults in `schema.prisma` (`model SecuritySettings`).
 *
 * Signup does not create this row — only the seed does — so a real workspace
 * reads these until it saves for the first time. They are duplicated here
 * rather than read from the database because a read should not have to write a
 * row to answer; `returns the schema defaults when no row exists` in
 * `settings.test.ts` pins the two copies together.
 */
const SECURITY_DEFAULTS = {
  bannedCustomerIps: [] as string[],
  fileSharingEnabled: true,
  allowedFileTypes: ['image/png', 'image/jpeg', 'application/pdf'],
  maxFileSizeBytes: 10_485_760,
  spamFilterEnabled: true,
  requireTwoFactor: false,
  ipAllowlistEnforced: false,
  sessionIdleTimeoutSeconds: null as number | null,
  maxConcurrentSessions: null as number | null,
} as const;

/**
 * A banned visitor IP (FR-MOD-08.9.2). Validated as a real IPv4/IPv6 address so
 * a typo cannot sit in the list looking like a rule while matching nobody, and
 * stored in the canonical shape the enforcement path compares against — the same
 * `normaliseIp` `isIpBanned` applies to the incoming address, so an admin's
 * `203.0.113.5` and a proxy's `::ffff:203.0.113.5` are one entry.
 */
const bannedIp = z
  .string()
  .trim()
  .max(45, 'not a valid IP address')
  .refine((value) => isIP(value) !== 0, 'must be a valid IPv4 or IPv6 address')
  .transform(normaliseIp);

/**
 * 30 days. A window longer than this is indistinguishable from "off" but still
 * a real number the sweep would act on, so it is rejected rather than stored.
 */
const CHAT_TIMEOUT_MAX_SECONDS = 2_592_000;

/**
 * The idle window before a chat auto-closes (FR-MOD-08.7.3). `null` disables it.
 * A stored value is always a positive integer: `.positive()` is what rejects a
 * zero or negative window, which — reaching the sweep — would close every live
 * chat at once. The database column and the sweep both assume this holds.
 */
const updateChatTimeoutBody = z.object({
  chat_timeout_seconds: z.number().int().positive().max(CHAT_TIMEOUT_MAX_SECONDS).nullable(),
});

/**
 * Same 30-day ceiling as `chat_timeout_seconds`: an idle window longer than
 * this is indistinguishable from "off" but still a real number the
 * enforcement sweep (FR-MOD-08.9.6-g) would act on, so it is rejected rather
 * than stored.
 */
const SESSION_IDLE_TIMEOUT_MAX_SECONDS = CHAT_TIMEOUT_MAX_SECONDS;

/**
 * Widget appearance (FR-MOD-11.7). Every field is optional so the customisation
 * screen can save one control at a time, but a body with none is rejected —
 * empty is a mistake, not "reset to defaults". The colour is pinned to the same
 * `#rrggbb` shape the database CHECK and `@nexa/types` normaliser enforce, so a
 * value that reaches the install snippet and CSS can only ever be a colour.
 */
const updateWidgetBody = z
  .object({
    primary_color: z
      .string()
      .trim()
      .toLowerCase()
      .regex(WIDGET_COLOR_PATTERN, 'must be a hex colour such as #2d67fa')
      .optional(),
    position: z.enum(WIDGET_POSITIONS as unknown as [string, ...string[]]).optional(),
    theme: z.enum(WIDGET_THEMES as unknown as [string, ...string[]]).optional(),
    mobile_fullscreen: z.boolean().optional(),
    powered_by: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

/**
 * Sales tracker configuration (FR-MOD-13.5). Every field is optional so the
 * settings screen can save one control at a time, but a body with none is
 * rejected — empty is a mistake, not "reset to defaults".
 *
 * `.strict()`, unlike the other settings bodies here, because this one is
 * partial *and* every field changes what a revenue report claims: a mistyped
 * `attribution_window` would otherwise be stripped, the upsert would write
 * nothing, and the screen would report a successful save of a window that was
 * never stored. The currency is upper-cased before the whitelist check so
 * `usd` from a hand-written call is the same configuration as `USD`.
 */
const updateSalesTrackerBody = z
  .object({
    enabled: z.boolean().optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.enum(SALES_TRACKER_CURRENCIES as unknown as [string, ...string[]]))
      .optional(),
    attribution_window_days: z
      .number()
      .int()
      .min(SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS)
      .max(SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS)
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const updateSecurityBody = z
  .object({
    banned_customer_ips: z
      .array(bannedIp)
      .max(1000)
      // Deduped after normalisation so the same address in two shapes does not
      // become two entries. Order is not significant — membership is.
      .transform((ips) => [...new Set(ips)])
      .optional(),
    file_sharing_enabled: z.boolean().optional(),
    allowed_file_types: z
      .array(z.string().trim().toLowerCase().max(255))
      .max(50)
      .refine((types) => types.every((type) => MIME.test(type)), {
        message: 'each entry must be a MIME type such as image/png',
      })
      .optional(),
    max_file_size_bytes: z.number().int().min(1).max(MAX_FILE_SIZE_CEILING).optional(),
    spam_filter_enabled: z.boolean().optional(),
    require_two_factor: z.boolean().optional(),
    ip_allowlist_enforced: z.boolean().optional(),
    // `.positive()` rejects zero/negative for the same reason chat-timeout
    // does: 0 is not "off" here, null is — a stored 0 would reach the
    // enforcement sweep as a real number and expire every session at once.
    session_idle_timeout_seconds: z
      .number()
      .int()
      .positive()
      .max(SESSION_IDLE_TIMEOUT_MAX_SECONDS)
      .nullable()
      .optional(),
    // Capped at `MAX_ACTIVE_TOKENS_PER_OWNER`: token issuance already refuses
    // a 26th live session, so a stored value above that ceiling could never
    // take effect and would only mislead whoever reads it back.
    max_concurrent_sessions: z
      .number()
      .int()
      .positive()
      .max(MAX_ACTIVE_TOKENS_PER_OWNER)
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const uuid = z.string().uuid();

/**
 * Same normalisation the inbox applies when an agent tags a conversation
 * (`chat-service.tagThread`): trimmed and lowercased. Keeping the two in step is
 * the point of the library — otherwise `VIP` typed in the composer and `vip`
 * curated here would be two labels that look like one.
 */
const tagName = z.string().trim().toLowerCase().min(1).max(64);
const tagGroupIds = z.array(z.coerce.bigint()).max(50);

const createTagBody = z.object({
  name: tagName,
  group_ids: tagGroupIds.default([]),
});

const updateTagBody = z
  .object({
    name: tagName.optional(),
    group_ids: tagGroupIds.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

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

/** Prisma's unique-violation code, raised by the tenant-scoped indexes here. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const createExpertiseBody = z.object({
  name: z.string().trim().min(1).max(EXPERTISE_NAME_MAX_LENGTH),
});

/** A small per-license integer id (`expertise.id`), taken straight from the path. */
const expertiseIdParam = z.coerce.bigint();

/**
 * The slug the `(license_id, slug)` unique index is enforced on. Lower-cased and
 * whitespace-collapsed rather than stripped to ASCII, so a non-Latin name keeps
 * a meaningful slug — the point is a stable, case/spacing-insensitive identity
 * per licence, matching the seed's `technical-support` form. Never empty: `name`
 * is validated non-empty first.
 */
function expertiseSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function serialiseExpertise(area: { id: bigint; name: string; slug: string }) {
  return { id: Number(area.id), name: area.name, slug: area.slug };
}

export default async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // --- Trusted domains -------------------------------------------------------

  app.get(
    '/settings/trusted-domains',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) =>
        tx.trustedDomain.findMany({ orderBy: { domain: 'asc' } }),
      );
      return reply.send({
        items: items.map((d) => ({
          id: d.id,
          domain: d.domain,
          include_subdomains: d.includeSubdomains,
          created_at: d.createdAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    '/settings/trusted-domains',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(addDomainBody, request.body);
      const tenant = request.tenant();

      // Normalised with the same rule the token endpoint applies to an Origin
      // header. A domain stored in any other shape would sit in the list
      // looking correct and never match anything.
      const domain = normaliseTrustedDomain(body.domain);
      if (!domain) {
        throw ApiError.validation(
          'Enter a hostname such as shop.example, or a URL to take one from.',
        );
      }

      try {
        const created = await request.withTenant(async (tx) => {
          const row = await tx.trustedDomain.create({
            data: {
              organizationId: tenant.organizationId,
              licenseId: tenant.licenseId,
              domain,
              includeSubdomains: body.include_subdomains,
            },
          });
          // Written in the same transaction as the change: the trail can never
          // disagree with the allowlist, because either both land or neither.
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'settings.trusted_domain_added',
            target: `trusted_domain:${row.id}`,
            metadata: { domain },
          });
          return row;
        });

        return reply.status(201).send({
          id: created.id,
          domain: created.domain,
          include_subdomains: created.includeSubdomains,
          created_at: created.createdAt.toISOString(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', `${domain} is already on the allowlist.`);
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { domainId: string } }>(
    '/settings/trusted-domains/:domainId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const domainId = parse(uuid, request.params.domainId);

      const deleted = await request.withTenant(async (tx) => {
        // Scoped delete rather than `delete by id`: the id alone would let a
        // caller remove another tenant's domain if RLS were ever misconfigured.
        const { count } = await tx.trustedDomain.deleteMany({ where: { id: domainId } });
        // Only record a removal that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'settings.trusted_domain_removed',
            target: `trusted_domain:${domainId}`,
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Domain not found.');

      return reply.status(204).send();
    },
  );

  // --- IP allow-list (FR-MOD-08.9.6) -----------------------------------------
  //
  // The allow-side counterpart to `banned_customer_ips`: those addresses are
  // refused on the customer surface; these are the only ones admitted to the
  // agent/admin panel. This surface only *manages* the list — enforcement (which
  // request is refused) lands in 08.9.6-e. What matters here is that a saved list
  // is always well-formed and can never exclude the very address it is saved from.

  app.get(
    '/settings/ip-allowlist',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) =>
        tx.ipAllowlistEntry.findMany({ orderBy: { entry: 'asc' } }),
      );
      return reply.send({
        items: items.map((e) => ({
          id: e.id,
          entry: e.entry,
          label: e.label,
          created_at: e.createdAt.toISOString(),
        })),
      });
    },
  );

  app.post(
    '/settings/ip-allowlist',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(addIpAllowlistBody, request.body);
      const tenant = request.tenant();

      // Validated with the parser the enforcement gate will reuse, then stored in
      // canonical form: `10.0.0.5/24` and `10.0.0.0/24` become one string, so the
      // unique index catches a duplicate and a typo cannot sit in the list looking
      // like a rule while admitting no one — or a neighbouring network.
      const parsed = parseAllowlistEntry(body.entry);
      if (!parsed) {
        throw ApiError.validation(
          'Enter a single IPv4/IPv6 address or a CIDR range such as 10.0.0.0/24.',
        );
      }
      const canonical = formatAllowlistEntry(parsed);

      try {
        const created = await request.withTenant(async (tx) => {
          // Self-lockout guard: the resulting list must still admit the address
          // the caller is connecting from, or the first entry with a typo would
          // lock a workspace out of its own console the moment enforcement is on —
          // the availability risk an allow-list carries. Checked against the whole
          // proposed list (existing entries plus the new one) inside the same
          // transaction, so it cannot race a concurrent write.
          const existing = await tx.ipAllowlistEntry.findMany({ select: { entry: true } });
          const nextEntries = [...existing.map((e) => e.entry), canonical];
          if (wouldLockOut(request.ip, nextEntries)) {
            throw ApiError.validation(
              'That would lock you out: the list must still include the address you are connecting from.',
            );
          }

          const row = await tx.ipAllowlistEntry.create({
            data: {
              organizationId: tenant.organizationId,
              licenseId: tenant.licenseId,
              entry: canonical,
              label: body.label ?? null,
            },
          });
          // Same transaction as the change, so the trail can never disagree with
          // the list. The rule is recorded; the caller's own address is not copied
          // into metadata — it is PII and already lives in the entry's `ip` column.
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'settings.ip_allowlist_added',
            target: `ip_allowlist:${row.id}`,
            metadata: { entry: canonical },
          });
          return row;
        });

        return reply.status(201).send({
          id: created.id,
          entry: created.entry,
          label: created.label,
          created_at: created.createdAt.toISOString(),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', `${canonical} is already on the allowlist.`);
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { entryId: string } }>(
    '/settings/ip-allowlist/:entryId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const entryId = parse(uuid, request.params.entryId);

      const deleted = await request.withTenant(async (tx) => {
        // Read the entry first so the audit trail can name which rule went, then
        // delete tenant-scoped: the id alone would let a caller remove another
        // tenant's entry if RLS were ever misconfigured. A cross-tenant id matches
        // nothing here and surfaces as 404, never 403 — a 403 would confirm the id
        // is real and turn short IDs into an enumeration oracle (NFR-S5).
        const found = await tx.ipAllowlistEntry.findFirst({
          where: { id: entryId },
          select: { entry: true },
        });
        const { count } = await tx.ipAllowlistEntry.deleteMany({ where: { id: entryId } });
        // Only record a removal that actually happened.
        if (count > 0 && found) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'settings.ip_allowlist_removed',
            target: `ip_allowlist:${entryId}`,
            metadata: { entry: found.entry },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Allowlist entry not found.');

      return reply.status(204).send();
    },
  );

  // --- Single sign-on (NFR-S11) ----------------------------------------------
  //
  // The federation configuration a workspace has saved, and — since S11-a2 — the
  // surface that writes it. Listing still signs nobody in: no assertion is
  // accepted and no session is minted from a connection yet (S11-d).
  //
  // Read is gated twice, like the audit-log read: the scope says the *token* may
  // read access rules, `admin` says the *person* behind it may. A row names the
  // workspace's identity provider, which is reconnaissance for a targeted phish
  // well before it is useful to an attacker any other way — and once S11-h makes
  // SSO the only way in, it names the single door too. A rank-and-file agent
  // holding an over-broad PAT has no reason to read that.
  //
  // WRITE IS OWNER ONLY — `exactRole`, and admin is deliberately not enough.
  // This is the sharpest privilege line in the product: whoever sets
  // `idp_certificate_pem` chooses the key assertions are checked against, so
  // they can mint a signed assertion for any colleague in the workspace and sign
  // in as them. That is not "administering settings", it is taking over every
  // account at once, and it is a strictly larger power than an admin otherwise
  // holds — an admin can suspend a teammate but cannot become one. Everything
  // else here is gated at `admin`; this one step up is the whole point.

  app.get(
    '/settings/sso',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const now = new Date();
      const items = await request.withTenant((tx) =>
        tx.ssoConnection.findMany({ orderBy: { name: 'asc' } }),
      );
      return reply.send({ items: items.map((row) => serialiseSsoConnection(row, now)) });
    },
  );

  app.post(
    '/settings/sso',
    { config: { scopes: ['access_rules:rw'], exactRole: 'owner' } },
    async (request, reply) => {
      const body = parse(createSsoBody, request.body);
      const tenant = request.tenant();

      // Both validated before the transaction opens: neither touches the
      // database, and a rejection here is the common case for a hand-typed
      // metadata form.
      const ssoUrl = readFederationUrl(body.idp_sso_url);
      const facts = readIdpCertificate(body.idp_certificate_pem, new Date());

      try {
        const created = await request.withTenant(async (tx) => {
          const row = await tx.ssoConnection.create({
            data: {
              licenseId: tenant.licenseId,
              name: body.name,
              idpEntityId: body.idp_entity_id,
              // Stored as parsed rather than as typed — host case and a missing
              // trailing slash are the same endpoint, and the redirect S11-d
              // builds uses this string, so what is stored is what is used.
              idpSsoUrl: ssoUrl,
              idpCertificatePem: body.idp_certificate_pem,
              attributeMapping: body.attribute_mapping ?? {},
              allowIdpInitiated: body.allow_idp_initiated,
              enabled: body.enabled,
            },
          });
          await writeAuditEntry(
            tx,
            request.auditContext(),
            ssoAuditEntry(row.id, 'created', body, facts),
          );
          return row;
        });

        return reply.status(201).send(serialiseSsoConnection(created, new Date()));
      } catch (error) {
        // The `(license_id, idp_entity_id)` index. Two connections claiming one
        // EntityID would make "whose certificate verifies this assertion?"
        // ambiguous exactly where the answer is the security decision.
        if (isUniqueViolation(error)) {
          throw new ApiError(
            'not_allowed',
            'A connection for that identity provider already exists.',
          );
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { connectionId: string } }>(
    '/settings/sso/:connectionId',
    { config: { scopes: ['access_rules:rw'], exactRole: 'owner' } },
    async (request, reply) => {
      const connectionId = parse(uuid, request.params.connectionId);
      const body = parse(updateSsoBody, request.body);
      const now = new Date();

      const ssoUrl =
        body.idp_sso_url === undefined ? undefined : readFederationUrl(body.idp_sso_url);
      const facts =
        body.idp_certificate_pem === undefined
          ? undefined
          : readIdpCertificate(body.idp_certificate_pem, now);

      try {
        const updated = await request.withTenant(async (tx) => {
          // Read first: the rotation decision needs the certificate being
          // replaced, and it has to be the one this same transaction writes over.
          // RLS scopes the read to the caller's license, so another workspace's
          // id simply matches nothing — a 404 that keeps ids un-enumerable
          // (NFR-S5) and, here, keeps a foreign connection un-editable.
          const existing = await tx.ssoConnection.findFirst({ where: { id: connectionId } });
          if (!existing) return null;

          const current = inspectIdpCertificate(existing.idpCertificatePem, now);
          // Compared by fingerprint, not by text: re-saving a form that resends
          // the same certificate with different line wrapping is not a rotation,
          // and treating it as one would silently drop a live overlap.
          const rotating =
            facts !== undefined && !(current.ok && current.facts.fingerprint === facts.fingerprint);

          if (body.retain_previous_certificate_hours !== undefined) {
            if (!rotating) {
              throw ApiError.validation(
                'That is the certificate already in use, so there is nothing to keep during a rotation.',
              );
            }
            if (!current.ok) {
              throw ApiError.validation(
                'The certificate being replaced is not usable, so keeping it would extend nothing. Rotate without an overlap.',
              );
            }
          }

          // A connection may only be switched on behind a certificate that can
          // actually verify something today — otherwise `enabled` advertises a
          // door that refuses everyone, and the failure surfaces as "SSO is
          // broken" long after the change that caused it.
          if (body.enabled === true && !(facts !== undefined || current.ok)) {
            throw ApiError.validation(
              'This connection cannot be enabled while its certificate is unusable. Upload the current one from your identity provider first.',
            );
          }

          const overlap = rotating
            ? body.retain_previous_certificate_hours !== undefined
              ? {
                  previousCertificatePem: existing.idpCertificatePem,
                  previousCertificateExpiresAt: new Date(
                    now.getTime() + body.retain_previous_certificate_hours * 3_600_000,
                  ),
                }
              : // The default, and the reason it is the default: a rotation is
                // how a workspace answers a compromised IdP key, and an overlap
                // there keeps the attacker's certificate valid for exactly as
                // long as it is convenient.
                { previousCertificatePem: null, previousCertificateExpiresAt: null }
            : body.revoke_previous_certificate
              ? { previousCertificatePem: null, previousCertificateExpiresAt: null }
              : {};

          const row = await tx.ssoConnection.update({
            where: { id: existing.id },
            data: {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.idp_entity_id !== undefined ? { idpEntityId: body.idp_entity_id } : {}),
              ...(ssoUrl !== undefined ? { idpSsoUrl: ssoUrl } : {}),
              ...(body.idp_certificate_pem !== undefined
                ? { idpCertificatePem: body.idp_certificate_pem }
                : {}),
              ...(body.attribute_mapping !== undefined
                ? { attributeMapping: body.attribute_mapping }
                : {}),
              ...(body.allow_idp_initiated !== undefined
                ? { allowIdpInitiated: body.allow_idp_initiated }
                : {}),
              ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
              ...overlap,
            },
          });

          await writeAuditEntry(
            tx,
            request.auditContext(),
            ssoAuditEntry(row.id, 'updated', body, rotating ? facts : undefined),
          );
          return row;
        });

        if (!updated) throw ApiError.notFound('SSO connection not found.');
        return reply.send(serialiseSsoConnection(updated, now));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(
            'not_allowed',
            'A connection for that identity provider already exists.',
          );
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { connectionId: string } }>(
    '/settings/sso/:connectionId',
    { config: { scopes: ['access_rules:rw'], exactRole: 'owner' } },
    async (request, reply) => {
      const connectionId = parse(uuid, request.params.connectionId);

      const deleted = await request.withTenant(async (tx) => {
        // Tenant-scoped delete rather than delete-by-id: the id alone would let a
        // caller remove another workspace's federation if RLS were ever
        // misconfigured. Removing a connection is a way to *close* a door, so it
        // is recorded like the changes that open one.
        const { count } = await tx.ssoConnection.deleteMany({ where: { id: connectionId } });
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'settings.security_updated',
            target: `sso_connection:${connectionId}`,
            metadata: { resource: 'sso_connection', operation: 'deleted' },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('SSO connection not found.');

      return reply.status(204).send();
    },
  );

  // --- Canned responses ------------------------------------------------------

  app.get(
    '/settings/canned-responses',
    { config: { scopes: ['canned_responses--all:ro', 'canned_responses--groups:ro'] } },
    async (request, reply) => {
      const query = parse(cannedListQuery, request.query);

      const items = await request.withTenant((tx) =>
        tx.cannedResponse.findMany({
          where: query.scope ? { scope: query.scope } : {},
          orderBy: { shortcut: 'asc' },
        }),
      );

      return reply.send({ items: items.map(serialiseCanned) });
    },
  );

  app.post(
    '/settings/canned-responses',
    { config: { scopes: ['canned_responses--all:rw'] } },
    async (request, reply) => {
      const body = parse(createCannedBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      try {
        const created = await request.withTenant((tx) =>
          tx.cannedResponse.create({
            data: {
              licenseId: tenant.licenseId,
              shortcut: body.shortcut,
              text: body.text,
              scope: body.scope,
              updatedBy: principal.kind === 'agent' ? principal.accountId : null,
              updatedAt: new Date(),
            },
          }),
        );
        return reply.status(201).send(serialiseCanned(created));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError(
            'not_allowed',
            `#${body.shortcut} is already used for ${body.scope} replies.`,
          );
        }
        throw error;
      }
    },
  );

  app.patch<{ Params: { cannedResponseId: string } }>(
    '/settings/canned-responses/:cannedResponseId',
    { config: { scopes: ['canned_responses--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.cannedResponseId);
      const body = parse(updateCannedBody, request.body);
      const principal = request.requirePrincipal();

      try {
        const updated = await request.withTenant(async (tx) => {
          const existing = await tx.cannedResponse.findFirst({
            where: { id },
            select: { id: true },
          });
          if (!existing) throw ApiError.notFound('Saved reply not found.');

          return tx.cannedResponse.update({
            where: { id },
            data: {
              ...(body.shortcut !== undefined ? { shortcut: body.shortcut } : {}),
              ...(body.text !== undefined ? { text: body.text } : {}),
              updatedBy: principal.kind === 'agent' ? principal.accountId : null,
              updatedAt: new Date(),
            },
          });
        });
        return reply.send(serialiseCanned(updated));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', 'That shortcut is already used.');
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { cannedResponseId: string } }>(
    '/settings/canned-responses/:cannedResponseId',
    { config: { scopes: ['canned_responses--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.cannedResponseId);

      const deleted = await request.withTenant(async (tx) => {
        const { count } = await tx.cannedResponse.deleteMany({ where: { id } });
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `canned_response:${id}`,
            metadata: { kind: 'canned_response' },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Saved reply not found.');

      return reply.status(204).send();
    },
  );

  // --- Security / file sharing -----------------------------------------------

  app.get(
    '/settings/security',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      // Brand-scoped: the row belongs to the active brand (`X-Nexa-Brand`) or the
      // license default when none is named — so a settings screen never reads
      // another brand's row, and never an arbitrary one when several exist.
      const { row, brandId } = await request.withTenant(async (tx) => {
        const brandId = await resolveBrandId(tx, request.brandId);
        return { row: await tx.securitySettings.findFirst({ where: { brandId } }), brandId };
      });
      return reply.send(serialiseSecurity(row, brandId));
    },
  );

  app.patch(
    '/settings/security',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(updateSecurityBody, request.body);
      const tenant = request.tenant();

      const data = {
        ...(body.banned_customer_ips !== undefined
          ? { bannedCustomerIps: body.banned_customer_ips }
          : {}),
        ...(body.file_sharing_enabled !== undefined
          ? { fileSharingEnabled: body.file_sharing_enabled }
          : {}),
        ...(body.allowed_file_types !== undefined
          ? { allowedFileTypes: body.allowed_file_types }
          : {}),
        ...(body.max_file_size_bytes !== undefined
          ? { maxFileSizeBytes: body.max_file_size_bytes }
          : {}),
        ...(body.spam_filter_enabled !== undefined
          ? { spamFilterEnabled: body.spam_filter_enabled }
          : {}),
        ...(body.require_two_factor !== undefined
          ? { requireTwoFactor: body.require_two_factor }
          : {}),
        ...(body.ip_allowlist_enforced !== undefined
          ? { ipAllowlistEnforced: body.ip_allowlist_enforced }
          : {}),
        ...(body.session_idle_timeout_seconds !== undefined
          ? { sessionIdleTimeoutSeconds: body.session_idle_timeout_seconds }
          : {}),
        ...(body.max_concurrent_sessions !== undefined
          ? { maxConcurrentSessions: body.max_concurrent_sessions }
          : {}),
      };

      // Upsert because signup leaves no row: a workspace saving these for the
      // first time would otherwise get a 404 for settings it can plainly see.
      // Keyed by `(license, brand)` — the active brand or the license default —
      // so a save under one brand never overwrites another's row.
      const { updated, brandId } = await request.withTenant(async (tx) => {
        const brandId = await resolveBrandId(tx, request.brandId);
        const row = await tx.securitySettings.upsert({
          where: { licenseId_brandId: { licenseId: tenant.licenseId, brandId } },
          create: {
            ...SECURITY_DEFAULTS,
            bannedCustomerIps: [...SECURITY_DEFAULTS.bannedCustomerIps],
            allowedFileTypes: [...SECURITY_DEFAULTS.allowedFileTypes],
            ...data,
            licenseId: tenant.licenseId,
            brandId,
          },
          update: data,
        });
        // Field *names*, not values: the record shows what was touched without
        // copying the new configuration into an append-only table.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.security_updated',
          metadata: { fields: Object.keys(body) },
        });
        return { updated: row, brandId };
      });

      return reply.send(serialiseSecurity(updated, brandId));
    },
  );

  // --- Chat timeout (inbox behaviour) ----------------------------------------

  app.get(
    '/settings/chat-timeout',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      // Brand-scoped: the row for the active brand, or the license default when
      // none is named. No row means the feature was never turned on, which reads
      // as disabled.
      const { row, brandId } = await request.withTenant(async (tx) => {
        const brandId = await resolveBrandId(tx, request.brandId);
        return { row: await tx.inboxSettings.findFirst({ where: { brandId } }), brandId };
      });
      return reply.send(serialiseInbox(row, brandId));
    },
  );

  app.put(
    '/settings/chat-timeout',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(updateChatTimeoutBody, request.body);
      const tenant = request.tenant();

      // Upsert because signup leaves no row: a workspace enabling this for the
      // first time would otherwise get a 404 for a setting it can plainly see.
      // Keyed by `(license, brand)`, so a save under one brand leaves another's.
      const { updated, brandId } = await request.withTenant(async (tx) => {
        const brandId = await resolveBrandId(tx, request.brandId);
        const row = await tx.inboxSettings.upsert({
          where: { licenseId_brandId: { licenseId: tenant.licenseId, brandId } },
          create: {
            licenseId: tenant.licenseId,
            brandId,
            chatTimeoutSeconds: body.chat_timeout_seconds,
          },
          update: { chatTimeoutSeconds: body.chat_timeout_seconds },
        });
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.chat_timeout_updated',
          metadata: { chat_timeout_seconds: body.chat_timeout_seconds },
        });
        return { updated: row, brandId };
      });

      return reply.send(serialiseInbox(updated, brandId));
    },
  );

  // --- Widget appearance (FR-MOD-11.7) ---------------------------------------

  app.get(
    '/settings/widget',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      // Brand-scoped: the row for the active brand, or the license default when
      // none is named. No row means the workspace has never customised this
      // brand's widget, which reads as the defaults.
      const { row, brandId } = await request.withTenant(async (tx) => {
        const brandId = await resolveBrandId(tx, request.brandId);
        return { row: await tx.widgetSettings.findFirst({ where: { brandId } }), brandId };
      });
      return reply.send(serialiseWidget(row, brandId));
    },
  );

  app.put(
    '/settings/widget',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(updateWidgetBody, request.body);
      const tenant = request.tenant();

      const data = {
        ...(body.primary_color !== undefined ? { primaryColor: body.primary_color } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.theme !== undefined ? { theme: body.theme } : {}),
        ...(body.mobile_fullscreen !== undefined
          ? { mobileFullscreen: body.mobile_fullscreen }
          : {}),
        ...(body.powered_by !== undefined ? { poweredBy: body.powered_by } : {}),
      };

      // Upsert because signup leaves no row: a workspace customising the widget
      // for the first time would otherwise get a 404 for settings it can see.
      // The create fills unset fields from the defaults, so a partial first save
      // lands a complete, valid row. Keyed by `(license, brand)`, so a save under
      // one brand leaves another brand's appearance untouched.
      const { updated, brandId } = await request.withTenant(async (tx) => {
        const brandId = await resolveBrandId(tx, request.brandId);
        const row = await tx.widgetSettings.upsert({
          where: { licenseId_brandId: { licenseId: tenant.licenseId, brandId } },
          create: {
            licenseId: tenant.licenseId,
            brandId,
            primaryColor: DEFAULT_WIDGET_APPEARANCE.primary_color,
            position: DEFAULT_WIDGET_APPEARANCE.position,
            theme: DEFAULT_WIDGET_APPEARANCE.theme,
            mobileFullscreen: DEFAULT_WIDGET_APPEARANCE.mobile_fullscreen,
            poweredBy: DEFAULT_WIDGET_APPEARANCE.powered_by,
            ...data,
          },
          update: data,
        });
        // Field names, not values: the trail shows what was touched without
        // copying the configuration into an append-only table.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.widget_updated',
          metadata: { fields: Object.keys(body) },
        });
        return { updated: row, brandId };
      });

      return reply.send(serialiseWidget(updated, brandId));
    },
  );

  // --- Sales tracker (FR-MOD-13.5) -------------------------------------------

  app.get(
    '/settings/sales-tracker',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      // License-scoped, not brand-scoped, so `findFirst` under RLS is already
      // this license's only row. No row means the workspace has never
      // configured tracking, which reads as the defaults — off — rather than
      // materialising a row to answer a read.
      const row = await request.withTenant((tx) => tx.salesTrackerSettings.findFirst());
      return reply.send(serialiseSalesTracker(row));
    },
  );

  app.put(
    '/settings/sales-tracker',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const body = parse(updateSalesTrackerBody, request.body);
      const tenant = request.tenant();

      const data = {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.attribution_window_days !== undefined
          ? { attributionWindowDays: body.attribution_window_days }
          : {}),
      };

      // Upsert because signup leaves no row: a workspace turning tracking on
      // for the first time would otherwise get a 404 for a setting it can
      // plainly see. The create fills unset fields from the defaults, so a
      // partial first save lands a complete, valid row. Keyed on the license
      // alone — the table's primary key — so a second save updates rather than
      // adding a duplicate configuration.
      const updated = await request.withTenant(async (tx) => {
        const row = await tx.salesTrackerSettings.upsert({
          where: { licenseId: tenant.licenseId },
          create: {
            licenseId: tenant.licenseId,
            enabled: DEFAULT_SALES_TRACKER_CONFIG.enabled,
            currency: DEFAULT_SALES_TRACKER_CONFIG.currency,
            attributionWindowDays: DEFAULT_SALES_TRACKER_CONFIG.attribution_window_days,
            ...data,
          },
          update: data,
        });
        // Field names, not values: the trail shows what was touched without
        // copying the configuration into an append-only table.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.sales_tracker_updated',
          metadata: { fields: Object.keys(body) },
        });
        return row;
      });

      return reply.send(serialiseSalesTracker(updated));
    },
  );

  // --- Routing rules ---------------------------------------------------------

  app.get(
    '/settings/routing-rules',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const { rules, groups } = await request.withTenant(async (tx) => ({
        rules: await tx.routingRule.findMany({
          orderBy: [{ isFallback: 'asc' }, { priority: 'asc' }],
        }),
        groups: await tx.group.findMany({ select: { id: true, name: true } }),
      }));

      const names = new Map(groups.map((g) => [g.id.toString(), g.name]));

      return reply.send({
        items: rules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          kind: rule.kind,
          conditions: rule.conditions,
          target_group_id: rule.targetGroupId === null ? null : Number(rule.targetGroupId),
          // Resolved here so the UI does not have to fetch groups separately
          // just to render a rule as anything other than a bare number.
          target_group_name:
            rule.targetGroupId === null ? null : (names.get(rule.targetGroupId.toString()) ?? null),
          priority: rule.priority,
          is_fallback: rule.isFallback,
          enabled: rule.enabled,
        })),
      });
    },
  );

  app.patch<{ Params: { ruleId: string } }>(
    '/settings/routing-rules/:ruleId',
    { config: { scopes: ['access_rules:rw'] } },
    async (request, reply) => {
      const ruleId = parse(uuid, request.params.ruleId);
      const body = parse(updateRuleBody, request.body);

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.routingRule.findFirst({ where: { id: ruleId } });
        if (!existing) throw ApiError.notFound('Routing rule not found.');

        // Disabling the fallback would leave conversations that match no rule
        // with nowhere to go. They would sit unassigned, and nothing about the
        // configuration would look wrong.
        if (existing.isFallback && body.enabled === false) {
          throw new ApiError(
            'not_allowed',
            'The fallback rule cannot be disabled — conversations matching nothing would be dropped.',
          );
        }

        if (body.target_group_id !== undefined && body.target_group_id !== null) {
          const group = await tx.group.findFirst({
            where: { id: body.target_group_id },
            select: { id: true },
          });
          if (!group) throw ApiError.validation('That team does not exist.');
        }

        // A rule may narrow routing to agents holding certain expertise
        // (FR-MOD-08.6.3). Every id must name an area on this workspace: RLS
        // scopes the lookup to the caller's licence, so a cross-tenant or unknown
        // id simply is not found — a 404 that keeps ids un-enumerable across
        // tenants (NFR-S5). The `conditions` object replaces the rule's stored
        // one wholesale; expertise ids are stored as plain numbers because jsonb
        // has no bigint, and dropped entirely when empty so a rule without a
        // requirement stores no marker for one.
        let conditionsData: Prisma.InputJsonValue | undefined;
        if (body.conditions !== undefined) {
          const expertiseIds = body.conditions.expertise_ids
            ? [...new Set(body.conditions.expertise_ids.map((id) => id.toString()))].map((s) =>
                BigInt(s),
              )
            : [];
          if (expertiseIds.length > 0) {
            const found = await tx.expertise.findMany({
              where: { id: { in: expertiseIds } },
              select: { id: true },
            });
            if (found.length !== expertiseIds.length) {
              throw ApiError.notFound('One or more expertise areas were not found.');
            }
          }
          conditionsData = {
            ...(body.conditions.url_contains ? { url_contains: body.conditions.url_contains } : {}),
            ...(body.conditions.url_equals ? { url_equals: body.conditions.url_equals } : {}),
            ...(body.conditions.country_codes
              ? { country_codes: body.conditions.country_codes }
              : {}),
            ...(expertiseIds.length > 0
              ? { expertise_ids: expertiseIds.map((id) => Number(id)) }
              : {}),
          };
        }

        const row = await tx.routingRule.update({
          where: { id: ruleId },
          data: {
            ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
            ...(body.priority !== undefined ? { priority: body.priority } : {}),
            ...(body.target_group_id !== undefined ? { targetGroupId: body.target_group_id } : {}),
            ...(conditionsData !== undefined ? { conditions: conditionsData } : {}),
          },
        });
        // Routing decides who sees which conversations, so a change to it is a
        // security-relevant configuration event.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'settings.routing_rule_updated',
          target: `routing_rule:${ruleId}`,
          metadata: { fields: Object.keys(body) },
        });
        return row;
      });

      const groupName =
        updated.targetGroupId === null
          ? null
          : ((
              await request.withTenant((tx) =>
                tx.group.findFirst({
                  where: { id: updated.targetGroupId! },
                  select: { name: true },
                }),
              )
            )?.name ?? null);

      return reply.send({
        id: updated.id,
        name: updated.name,
        kind: updated.kind,
        conditions: updated.conditions,
        target_group_id: updated.targetGroupId === null ? null : Number(updated.targetGroupId),
        target_group_name: groupName,
        priority: updated.priority,
        is_fallback: updated.isFallback,
        enabled: updated.enabled,
      });
    },
  );

  // --- Expertise catalogue (skill-based routing — FR-MOD-08.6.3) -------------

  // Reading is open to any `access_rules` holder — an assignment screen needs
  // the vocabulary. Writing is admin/owner only: `minimumRole: admin` is the
  // person gate (a bot or agent-role token is refused there), the scope is the
  // token gate. The pair mirrors `/agents/:id/role`.
  app.get(
    '/settings/expertise',
    { config: { scopes: ['access_rules:ro', 'access_rules:rw'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) =>
        tx.expertise.findMany({ where: { archived: false }, orderBy: { name: 'asc' } }),
      );
      return reply.send({ items: items.map(serialiseExpertise) });
    },
  );

  app.post(
    '/settings/expertise',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(createExpertiseBody, request.body);
      const tenant = request.tenant();
      const slug = expertiseSlug(body.name);

      try {
        const created = await request.withTenant((tx) =>
          tx.expertise.create({
            data: { licenseId: tenant.licenseId, name: body.name, slug },
          }),
        );
        return reply.status(201).send(serialiseExpertise(created));
      } catch (error) {
        // The slug is derived from the name, so a collision means an area with
        // the same name up to case and spacing already exists.
        if (isUniqueViolation(error)) {
          throw new ApiError(
            'not_allowed',
            'An expertise area with a similar name already exists.',
          );
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { expertiseId: string } }>(
    '/settings/expertise/:expertiseId',
    { config: { scopes: ['access_rules:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const id = parse(expertiseIdParam, request.params.expertiseId);

      // RLS scopes the delete to the caller's licence, so another tenant's id
      // simply matches nothing — a 404 that keeps ids un-enumerable (NFR-S5).
      // The assignment rows cascade with the area (composite FK).
      const { count } = await request.withTenant((tx) =>
        tx.expertise.deleteMany({ where: { id } }),
      );
      if (count === 0) throw ApiError.notFound('Expertise area not found.');

      return reply.status(204).send();
    },
  );

  // --- Tag library -----------------------------------------------------------

  // Read is open to any tag scope, `--groups` included, because the inbox reads
  // this list to suggest tags as an agent types: an ordinary agent (who holds
  // `tags--groups:ro`, not the tenant-wide set) still needs to see the
  // vocabulary they are expected to apply.
  app.get(
    '/settings/tags',
    { config: { scopes: ['tags--all:ro', 'tags--groups:ro'] } },
    async (request, reply) => {
      const items = await request.withTenant((tx) =>
        tx.tag.findMany({
          orderBy: { name: 'asc' },
          include: { _count: { select: { threads: true } } },
        }),
      );
      return reply.send({ items: items.map(serialiseTag) });
    },
  );

  app.post('/settings/tags', { config: { scopes: ['tags--all:rw'] } }, async (request, reply) => {
    const body = parse(createTagBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    try {
      const created = await request.withTenant(async (tx) => {
        await assertGroupsExist(tx, body.group_ids);
        return tx.tag.create({
          data: {
            licenseId: tenant.licenseId,
            name: body.name,
            groupIds: body.group_ids,
            authorId: principal.kind === 'agent' ? principal.accountId : null,
          },
          include: { _count: { select: { threads: true } } },
        });
      });
      return reply.status(201).send(serialiseTag(created));
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError('not_allowed', `The tag “${body.name}” already exists.`);
      }
      throw error;
    }
  });

  app.patch<{ Params: { tagId: string } }>(
    '/settings/tags/:tagId',
    { config: { scopes: ['tags--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.tagId);
      const body = parse(updateTagBody, request.body);

      try {
        const updated = await request.withTenant(async (tx) => {
          const existing = await tx.tag.findFirst({ where: { id }, select: { id: true } });
          if (!existing) throw ApiError.notFound('Tag not found.');
          if (body.group_ids !== undefined) await assertGroupsExist(tx, body.group_ids);

          return tx.tag.update({
            where: { id },
            data: {
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.group_ids !== undefined ? { groupIds: body.group_ids } : {}),
            },
            include: { _count: { select: { threads: true } } },
          });
        });
        return reply.send(serialiseTag(updated));
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ApiError('not_allowed', 'A tag with that name already exists.');
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { tagId: string } }>(
    '/settings/tags/:tagId',
    { config: { scopes: ['tags--all:rw'] } },
    async (request, reply) => {
      const id = parse(uuid, request.params.tagId);

      const deleted = await request.withTenant(async (tx) => {
        // Scoped delete, not `delete by id`: the id alone would let a caller
        // remove another tenant's tag if RLS were ever misconfigured.
        const { count } = await tx.tag.deleteMany({ where: { id } });
        // Only record a delete that actually happened — a 404 (nothing matched)
        // is not an event worth an entry.
        if (count > 0) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'data.deleted',
            target: `tag:${id}`,
            metadata: { kind: 'tag' },
          });
        }
        return count;
      });
      if (deleted === 0) throw ApiError.notFound('Tag not found.');

      return reply.status(204).send();
    },
  );
}

/**
 * Rejects a create/update that names a team the workspace does not have.
 *
 * Mirrors the check the routing-rule editor makes: a `group_id` that resolves to
 * nothing would scope a tag to a team that cannot exist, so it would silently
 * apply to no one. RLS narrows the lookup to this tenant, so referencing another
 * workspace's group fails here exactly as an unknown id does.
 */
async function assertGroupsExist(tx: Prisma.TransactionClient, groupIds: bigint[]): Promise<void> {
  if (groupIds.length === 0) return;
  const unique = [...new Set(groupIds.map((id) => id.toString()))];
  const found = await tx.group.findMany({
    where: { id: { in: groupIds } },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw ApiError.validation('One or more of those teams do not exist.');
  }
}

function serialiseTag(row: {
  id: string;
  name: string;
  groupIds: bigint[];
  authorId: string | null;
  createdAt: Date;
  _count?: { threads: number };
}) {
  return {
    id: row.id,
    name: row.name,
    group_ids: row.groupIds.map((id) => Number(id)),
    author_id: row.authorId,
    usage_count: row._count?.threads ?? 0,
    created_at: row.createdAt.toISOString(),
  };
}

function serialiseSecurity(
  row: {
    bannedCustomerIps: string[];
    fileSharingEnabled: boolean;
    allowedFileTypes: string[];
    maxFileSizeBytes: number;
    spamFilterEnabled: boolean;
    requireTwoFactor: boolean;
    ipAllowlistEnforced: boolean;
    sessionIdleTimeoutSeconds: number | null;
    maxConcurrentSessions: number | null;
    updatedAt: Date;
  } | null,
  brandId: string,
) {
  const value = row ?? SECURITY_DEFAULTS;
  return {
    brand_id: brandId,
    banned_customer_ips: [...value.bannedCustomerIps],
    file_sharing_enabled: value.fileSharingEnabled,
    allowed_file_types: [...value.allowedFileTypes],
    max_file_size_bytes: value.maxFileSizeBytes,
    spam_filter_enabled: value.spamFilterEnabled,
    require_two_factor: value.requireTwoFactor,
    ip_allowlist_enforced: value.ipAllowlistEnforced,
    session_idle_timeout_seconds: value.sessionIdleTimeoutSeconds,
    max_concurrent_sessions: value.maxConcurrentSessions,
    updated_at: row ? row.updatedAt.toISOString() : null,
  };
}

function serialiseInbox(
  row: { chatTimeoutSeconds: number | null; updatedAt: Date } | null,
  brandId: string,
) {
  return {
    brand_id: brandId,
    chat_timeout_seconds: row?.chatTimeoutSeconds ?? null,
    updated_at: row ? row.updatedAt.toISOString() : null,
  };
}

/**
 * The widget appearance in the shared `WidgetAppearance` shape, plus when it was
 * last changed. No row means the defaults — the same fallback the schema column
 * defaults and the widget's own CSS encode, so all three describe one look.
 */
function serialiseWidget(
  row: {
    primaryColor: string;
    position: string;
    theme: string;
    mobileFullscreen: boolean;
    poweredBy: boolean;
    updatedAt: Date;
  } | null,
  brandId: string,
) {
  return {
    brand_id: brandId,
    primary_color: row?.primaryColor ?? DEFAULT_WIDGET_APPEARANCE.primary_color,
    position: row?.position ?? DEFAULT_WIDGET_APPEARANCE.position,
    theme: row?.theme ?? DEFAULT_WIDGET_APPEARANCE.theme,
    mobile_fullscreen: row?.mobileFullscreen ?? DEFAULT_WIDGET_APPEARANCE.mobile_fullscreen,
    powered_by: row?.poweredBy ?? DEFAULT_WIDGET_APPEARANCE.powered_by,
    updated_at: row ? row.updatedAt.toISOString() : null,
  };
}

/**
 * The sales tracker configuration, plus when it was last changed. No row means
 * the defaults — the same values the schema columns default to — so a workspace
 * that has never configured tracking reads "off" rather than an error.
 */
function serialiseSalesTracker(
  row: {
    enabled: boolean;
    currency: string;
    attributionWindowDays: number;
    updatedAt: Date;
  } | null,
) {
  return {
    enabled: row?.enabled ?? DEFAULT_SALES_TRACKER_CONFIG.enabled,
    currency: row?.currency ?? DEFAULT_SALES_TRACKER_CONFIG.currency,
    attribution_window_days:
      row?.attributionWindowDays ?? DEFAULT_SALES_TRACKER_CONFIG.attribution_window_days,
    updated_at: row ? row.updatedAt.toISOString() : null,
  };
}

/**
 * One SAML connection on the wire (NFR-S11). The certificate is sent in full:
 * it is the IdP's public signing certificate, the field an admin compares
 * against their IdP console to confirm a rotation landed, so masking it would
 * hide the one thing a misconfiguration is diagnosed from and protect nothing.
 *
 * The rotation overlap is reported only while it is live. A lapsed one is not
 * shown as an expired-but-present certificate, because that is a screen an
 * operator reads as "two certificates are configured" when in fact one of them
 * stopped counting — and `activePreviousCertificate` is the single place that
 * distinction is made, shared with the verifier (S11-b/S11-d).
 */
function serialiseSsoConnection(
  row: {
    id: string;
    name: string;
    idpEntityId: string;
    idpSsoUrl: string;
    idpCertificatePem: string;
    previousCertificatePem: string | null;
    previousCertificateExpiresAt: Date | null;
    attributeMapping: Prisma.JsonValue;
    allowIdpInitiated: boolean;
    enabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  now: Date,
): SsoConnection {
  const previous = activePreviousCertificate(row, now);
  return {
    id: row.id,
    name: row.name,
    idp_entity_id: row.idpEntityId,
    idp_sso_url: row.idpSsoUrl,
    idp_certificate_pem: row.idpCertificatePem,
    previous_certificate_pem: previous?.pem ?? null,
    previous_certificate_expires_at: previous?.expiresAt.toISOString() ?? null,
    attribute_mapping: readSsoAttributeMapping(row.attributeMapping),
    allow_idp_initiated: row.allowIdpInitiated,
    enabled: row.enabled,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * Validate an IdP sign-on URL, or refuse it by name (NFR-S11 · S11-a2).
 *
 * The rules live in `lib/sso-connection.ts`; this only turns a refusal into a
 * message an admin can act on. Each reason gets its own: "invalid URL" for a
 * `javascript:` paste teaches nothing, and the person reading it is configuring
 * a security boundary from an IdP console in another tab.
 */
function readFederationUrl(raw: string): string {
  const checked = checkFederationUrl(raw);
  if (checked.ok) return checked.url.toString();

  switch (checked.reason) {
    case 'scheme':
      throw ApiError.validation(
        'The sign-on URL must be an https address, like https://idp.example.com/sso.',
      );
    case 'credentials':
      throw ApiError.validation('Remove the username and password from the sign-on URL.');
    case 'fragment':
      throw ApiError.validation(
        'Remove the # fragment from the sign-on URL — an identity provider never sees it.',
      );
    case 'insecure':
      throw ApiError.validation('The sign-on URL must use https.');
    default:
      throw ApiError.validation(
        'Enter the sign-on URL from your identity provider, like https://idp.example.com/sso.',
      );
  }
}

/**
 * Validate an IdP signing certificate, or refuse it by name (NFR-S11 · S11-a2).
 *
 * Returns the facts worth recording — notably the SHA-256 fingerprint, which is
 * the only certificate-derived value that goes into the audit trail.
 */
function readIdpCertificate(pem: string, now: Date): CertificateFacts {
  const inspected = inspectIdpCertificate(pem, now);
  if (inspected.ok) return inspected.facts;

  switch (inspected.reason) {
    case 'multiple':
      throw ApiError.validation(
        'Paste one certificate, not a chain. To trust two at once during a key roll, rotate with retain_previous_certificate_hours instead.',
      );
    case 'expired':
      throw ApiError.validation(
        'That certificate has expired, so it can no longer verify anything. Copy the current one from your identity provider.',
      );
    case 'not_yet_valid':
      throw ApiError.validation(
        'That certificate is not valid yet, so it cannot verify a sign-in today.',
      );
    case 'weak_key':
      throw ApiError.validation(
        `That certificate's key is below ${MIN_RSA_MODULUS_BITS} bits and is not strong enough to be trusted with sign-in.`,
      );
    default:
      throw ApiError.validation(
        'That is not a certificate we can read. Paste the PEM block your identity provider publishes, BEGIN and END lines included.',
      );
  }
}

/**
 * The audit entry for an SSO connection change (NFR-S12).
 *
 * `settings.security_updated` — the existing action for workspace security
 * configuration — with the operation in metadata rather than a new action per
 * verb, so the trail stays queryable by one closed vocabulary.
 *
 * What goes in: which connection, what happened, and *which fields* were
 * touched. What never goes in: the certificate itself. The SHA-256 fingerprint
 * does, and only on a rotation — it is a digest of a public certificate, it is
 * what an IdP console shows next to that certificate, and "which trust anchor
 * did this person install" is precisely the question this entry has to answer
 * later. Storing the PEM instead would put a multi-kilobyte blob in an
 * append-only table to answer the same question worse.
 */
function ssoAuditEntry(
  connectionId: string,
  operation: 'created' | 'updated',
  body: Record<string, unknown>,
  rotated: CertificateFacts | undefined,
): AuditEntry {
  return {
    action: 'settings.security_updated',
    target: `sso_connection:${connectionId}`,
    metadata: {
      resource: 'sso_connection',
      operation,
      fields: Object.keys(body),
      ...(rotated ? { certificate_fingerprint: rotated.fingerprint } : {}),
    },
  };
}

function serialiseCanned(row: {
  id: string;
  shortcut: string;
  text: string;
  scope: string;
  groupId: bigint | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    shortcut: row.shortcut,
    text: row.text,
    scope: row.scope,
    group_id: row.groupId === null ? null : Number(row.groupId),
    updated_by: row.updatedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
