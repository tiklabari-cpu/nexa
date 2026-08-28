/**
 * Settings → Security: SAML SSO connections + SCIM provisioning tokens (S11-g).
 *
 * A pure consumer of surfaces three other alt-görevs already built and own:
 * the connection write endpoints (`POST|PATCH|DELETE /settings/sso`, S11-a2,
 * `exactRole: 'owner'`) and the SCIM token mint/revoke endpoints
 * (`/settings/scim-tokens`, S11-e, `minimumRole: 'admin'`). This screen opens
 * no new server surface — every rule it appears to enforce (owner-only
 * certificate writes, the token cap, certificate parsing) is the server's;
 * this only shows what it said and calls it with the right shape. Read
 * pattern follows `IpAllowlist.tsx` (list + add form + remove), the "shown
 * once" token panel follows `DeveloperPortal.tsx`'s `SecretOncePanel`
 * (tm 72 · 09.4-e) — same one-render-then-discard contract, applied here to
 * a SCIM token instead of an OAuth client secret.
 *
 * "Verify format" makes no network request. A server-side test against the
 * IdP's own URL would be SSRF against a target the caller chooses (PLAN
 * §D99) — S11-g's audit finding — so this checks only what can be checked
 * locally: the certificate parses as a PEM block, the entity id and sign-on
 * URL are well-formed, and the attribute mapping (if any) names an email
 * claim. The server still re-validates everything on submit; this exists so
 * a typo is caught before the round trip, not instead of the real check.
 *
 * `verifySsoMetadata` and its helpers are pure validation, called and tested
 * outside any component (`describe('verifySsoMetadata', …)` pins its English
 * `problems` verbatim) — kept untranslated on purpose, the same "kapsam dışı"
 * precedent `ticket-priority.ts` (I18N-c) and `kbSlugError` (I18N-h) set for a
 * pure logic module whose own tests pin exact English output.
 *
 * Federation is Enterprise-only (`entitlement: 'sso'`, FR-MOD-11.5), so adding
 * a connection can 403 with `details.entitlement` on a workspace that has
 * never upgraded. Read here to show the upsell, named the way `Sandbox.tsx`
 * and `SlaPolicy.tsx` already name theirs, rather than ADR-06's generic
 * `not_allowed` sentence (tm 133.12's finding — I18N-l's e2e run caught the
 * regression in `WidgetCustomization.tsx`; this screen had the same gap and
 * no e2e drove it, tm 144).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';

interface SsoAttributeMapping {
  email?: string;
  name?: string;
}

/**
 * One claimed domain and how far its ownership proof has got (PLAN §D134).
 *
 * The token is never here: it exists in the message sent to the domain's
 * reserved mailbox and as a digest on the server's row, and this screen only
 * ever passes it back in the direction it came from.
 */
interface SsoDomainRecord {
  domain: string;
  verified: boolean;
  verified_at: string | null;
  challenge_mailbox: string | null;
  challenge_sent_at: string | null;
}

interface SsoConnectionRecord {
  id: string;
  name: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
  previous_certificate_pem: string | null;
  previous_certificate_expires_at: string | null;
  /**
   * The domains this connection may actually provision from: the ones whose
   * ownership has been proved. Just-in-time provisioning — SAML sign-in and this
   * workspace's SCIM connector alike — is confined to them, so a connection
   * cannot adopt a stranger's account or occupy an address that never signed up
   * (PLAN §D116, §D134).
   */
  verified_domains: string[];
  /**
   * Every domain the connection claims, proved or not. Claiming and proving are
   * two acts, so this list is longer than the one above until each domain's
   * challenge comes back — and the screen has to show that difference, or an
   * owner reads "provisions nobody" with no way to tell why.
   */
  domains: SsoDomainRecord[];
  attribute_mapping: SsoAttributeMapping;
  allow_idp_initiated: boolean;
  enabled: boolean;
  /**
   * Password sign-in is refused for this workspace while this and `enabled` are
   * both true (S11-h). Reported as stored, so "required but switched off" is a
   * state the screen can show rather than one it silently renders as open.
   */
  enforced: boolean;
  created_at: string;
  updated_at: string;
}

interface CreateSsoConnectionBody {
  name: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
  verified_domains: string[];
  attribute_mapping?: SsoAttributeMapping;
  allow_idp_initiated: boolean;
  enabled: boolean;
}

/** The two switches on an existing connection; either may be sent alone. */
type SsoConnectionFlags = { id: string } & Partial<
  Pick<SsoConnectionRecord, 'enabled' | 'enforced'>
>;

interface ScimTokenRecord {
  id: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

interface ScimTokenCreated extends ScimTokenRecord {
  token: string;
}

/**
 * Mirrors the server's `minimumRole: 'admin'` gate on the two read routes
 * (`GET /settings/sso`, `GET /settings/scim-tokens` — routes/settings.ts,
 * which names this exact rationale: "gated twice, like the audit-log read").
 * This is the same courtesy hide `AuditLog` uses: whoever cannot read this
 * is not shown a door that only leads to a 403 — the routes stay the actual
 * boundary.
 */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

export function SsoConnection({ canEdit }: { canEdit: boolean }): ReactElement | null {
  const role = useAuth((s) => s.agent?.role ?? null);
  if (role === null || !VIEWER_ROLES.has(role)) return null;

  // Certificate writes are `exactRole: 'owner'` server-side — strictly above
  // `admin`, and deliberately so (POST /settings/sso's description: writing
  // the certificate lets its author sign in as any colleague). SCIM token
  // writes stay at `minimumRole: 'admin'`, already satisfied by VIEWER_ROLES.
  const isOwner = role === 'owner';

  return (
    <>
      <SsoConnections canEdit={canEdit && isOwner} restricted={canEdit && !isOwner} />
      <ScimTokens canEdit={canEdit} />
    </>
  );
}

// --- SAML connections ----------------------------------------------------------

export interface SsoMetadataCheck {
  ok: boolean;
  problems: string[];
}

const CERTIFICATE_BLOCK = /-----BEGIN CERTIFICATE-----\r?\n([\s\S]+?)-----END CERTIFICATE-----/;
const BASE64_ONLY = /^[A-Za-z0-9+/=\s]+$/;

function checkCertificateFormat(pem: string): string | null {
  const trimmed = pem.trim();
  if (!trimmed) return 'The certificate is missing.';
  const match = CERTIFICATE_BLOCK.exec(trimmed);
  if (!match?.[1]) return 'Not a PEM certificate — expecting one BEGIN/END CERTIFICATE block.';
  const body = match[1].replace(/\s+/g, '');
  if (!body || !BASE64_ONLY.test(body)) return 'The certificate body is not valid base64.';
  try {
    atob(body);
  } catch {
    return 'The certificate body is not valid base64.';
  }
  return null;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

function checkSsoUrlFormat(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return 'The sign-on URL is missing.';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return 'Not a valid URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Must be an http(s) URL.';
  if (url.username || url.password) return 'Remove the embedded credentials from the URL.';
  if (url.hash) return 'Remove the #fragment from the URL.';
  if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
    return 'Plain http is only allowed for a loopback address — use https.';
  }
  return null;
}

/**
 * The domains typed into the form, normalised the way the server will store
 * them (§D116 MEDIUM (a)).
 *
 * Comma or newline separated, because both are how a list of domains arrives
 * from a browser: typed with commas, pasted from a column. Lower-cased and
 * de-duplicated here so what the field shows after a save matches what was
 * sent; the server normalises again and is the actual authority.
 */
export function parseVerifiedDomains(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,;]+/)
        .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
        .filter(Boolean),
    ),
  ];
}

/**
 * Local-only checks (no network request) for the metadata form: does the
 * certificate parse, are the entity id and sign-on URL well-formed, are the
 * verified domains bare domains, and — if an attribute mapping is being
 * configured at all — does it name the email claim JIT provisioning matches
 * accounts on.
 */
export function verifySsoMetadata(values: {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
  verified_domains: string;
  attribute_email: string;
  attribute_name: string;
}): SsoMetadataCheck {
  const problems: string[] = [];

  const entityId = values.idp_entity_id.trim();
  if (!entityId) problems.push('The IdP entity id is missing.');
  else if (entityId.length > 1024) problems.push('The IdP entity id is too long.');

  const urlProblem = checkSsoUrlFormat(values.idp_sso_url);
  if (urlProblem) problems.push(urlProblem);

  const certProblem = checkCertificateFormat(values.idp_certificate_pem);
  if (certProblem) problems.push(certProblem);

  const domains = parseVerifiedDomains(values.verified_domains);
  if (domains.length === 0) {
    problems.push(
      'Add at least one verified domain — without one this connection signs nobody in.',
    );
  } else if (domains.length > 20) {
    problems.push('That is more than 20 domains.');
  } else {
    // The wildcard gets its own sentence because it is the thing somebody
    // reaches for first, and "malformed" would not explain why it is refused:
    // verifying acme.com says nothing about who controls payroll.acme.com.
    const wildcard = domains.find((domain) => domain.includes('*'));
    if (wildcard) {
      problems.push(
        `Remove the wildcard from ${wildcard} — list each domain in full, subdomains included.`,
      );
    }
    const malformed = domains.find(
      (domain) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain),
    );
    if (malformed && malformed !== wildcard) {
      problems.push(`${malformed} is not a bare domain like acme.com.`);
    }
  }

  if (values.attribute_name.trim() && !values.attribute_email.trim()) {
    problems.push(
      'Add an email attribute too — a display name alone cannot identify who is signing in.',
    );
  }

  return { ok: problems.length === 0, problems };
}

function attributeMappingFrom(values: {
  attribute_email: string;
  attribute_name: string;
}): SsoAttributeMapping | undefined {
  const email = values.attribute_email.trim();
  const name = values.attribute_name.trim();
  if (!email && !name) return undefined;
  return { ...(email ? { email } : {}), ...(name ? { name } : {}) };
}

/**
 * The domains one connection claims, and the state of each one's proof (§D134).
 *
 * Its own component because it holds per-domain state — which challenge is open,
 * what the owner has typed into which box — and lifting that into the list would
 * make every keystroke re-render every connection.
 *
 * Nothing here is a rule: the server decides which mailboxes may be challenged,
 * how long a code lasts and how often one may be sent, and answers with a
 * sentence when it refuses. This shows the state and passes the code back.
 */
function DomainProofs({
  connection,
  canEdit,
  onChanged,
}: {
  connection: SsoConnectionRecord;
  canEdit: boolean;
  onChanged: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  /** Which domain's code box is open, and what has been typed into it. */
  const [answering, setAnswering] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const path = (domain: string, action: 'challenge' | 'verify') =>
    `/settings/sso/${connection.id}/domains/${encodeURIComponent(domain)}/${action}`;

  const challenge = useMutation({
    mutationFn: (domain: string) => api.post<SsoDomainRecord>(path(domain, 'challenge'), {}),
    onSuccess: (_result, domain) => {
      setAnswering(domain);
      setCode('');
      onChanged();
    },
  });

  const verify = useMutation({
    mutationFn: (input: { domain: string; token: string }) =>
      api.post<SsoDomainRecord>(path(input.domain, 'verify'), { token: input.token }),
    onSuccess: () => {
      setAnswering(null);
      setCode('');
      onChanged();
    },
  });

  // Both refusals are sentences the owner has to act on — "wait a minute", "that
  // code has expired", "that code does not match" — so the server's own message
  // is shown rather than a generic one that would strand them.
  const failure = challenge.error ?? verify.error;

  return (
    <div className="mt-1 space-y-1">
      {connection.domains.map((domain) => (
        <div key={domain.domain} className="flex flex-wrap items-center gap-2 text-2xs">
          <StatusDot
            tone={domain.verified ? 'success' : 'warning'}
            label={
              domain.verified
                ? t('settings.sso.domainVerified')
                : t('settings.sso.domainPendingStatus')
            }
          />
          <span className="font-mono text-content-secondary">{domain.domain}</span>
          {!domain.verified && (
            <span className="text-content-tertiary">
              {domain.challenge_mailbox
                ? t('settings.sso.domainChallengeSent', { mailbox: domain.challenge_mailbox })
                : t('settings.sso.domainPending')}
            </span>
          )}
          {canEdit && !domain.verified && (
            <>
              <button
                type="button"
                onClick={() => challenge.mutate(domain.domain)}
                disabled={challenge.isPending}
                className="rounded-md border border-border px-2 py-0.5 transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {domain.challenge_mailbox
                  ? t('settings.sso.domainResend')
                  : t('settings.sso.domainSendCode')}
              </button>
              {domain.challenge_mailbox && answering !== domain.domain && (
                <button
                  type="button"
                  onClick={() => {
                    setAnswering(domain.domain);
                    setCode('');
                  }}
                  className="rounded-md border border-border px-2 py-0.5 transition-colors hover:bg-surface-2"
                >
                  {t('settings.sso.domainEnterCode')}
                </button>
              )}
              {answering === domain.domain && (
                <>
                  <input
                    type="text"
                    value={code}
                    aria-label={t('settings.sso.domainCodeLabel', { domain: domain.domain })}
                    onChange={(event) => setCode(event.target.value)}
                    className="w-56 rounded-md border border-border bg-surface-1 px-2 py-0.5 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => verify.mutate({ domain: domain.domain, token: code })}
                    disabled={verify.isPending || code.trim() === ''}
                    className="rounded-md bg-brand-500 px-2 py-0.5 font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                  >
                    {t('settings.sso.domainVerifyAction')}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ))}
      {failure && (
        <ErrorNotice
          message={
            failure instanceof ApiClientError
              ? // i18n-ignore — the server names the exact obstacle (wait a minute, the code expired, it does not match); a generic sentence would leave the owner guessing which.
                failure.message
              : t('settings.sso.domainErrorFallback')
          }
        />
      )}
    </div>
  );
}

function SsoConnections({
  canEdit,
  restricted,
}: {
  canEdit: boolean;
  /** Scope allows writing but the role does not — explain the empty form, not just omit it. */
  restricted: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [allowIdpInitiated, setAllowIdpInitiated] = useState(false);
  const [enabledOnCreate, setEnabledOnCreate] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SsoMetadataCheck | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SsoConnectionRecord | null>(null);
  /**
   * Turning enforcement *on* is confirmed; turning it off is not. Asymmetric on
   * purpose — one closes the password door for every member of the workspace,
   * the other reopens it, and only the first is a change somebody can regret at
   * two in the morning. Same reasoning as the remove dialog next to it.
   */
  const [enforceTarget, setEnforceTarget] = useState<SsoConnectionRecord | null>(null);

  const list = useQuery({
    queryKey: ['settings', 'sso'],
    queryFn: () => api.get<{ items: SsoConnectionRecord[] }>('/settings/sso'),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['settings', 'sso'] });

  const create = useMutation({
    mutationFn: (body: CreateSsoConnectionBody) =>
      api.post<SsoConnectionRecord>('/settings/sso', body),
    onSuccess: invalidate,
  });

  const toggle = useMutation({
    mutationFn: ({ id, ...flags }: SsoConnectionFlags) =>
      api.patch<SsoConnectionRecord>(`/settings/sso/${id}`, flags),
    onSuccess: () => setEnforceTarget(null),
    ...optimisticCacheUpdate<{ items: SsoConnectionRecord[] }, SsoConnectionFlags>({
      queryClient,
      queryKey: ['settings', 'sso'],
      update: (current, { id, ...flags }) => ({
        items: (current?.items ?? []).map((c) => (c.id === id ? { ...c, ...flags } : c)),
      }),
    }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/settings/sso/${id}`),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidate();
    },
  });

  const form = useForm({
    initial: {
      name: '',
      idp_entity_id: '',
      idp_sso_url: '',
      idp_certificate_pem: '',
      verified_domains: '',
      attribute_email: '',
      attribute_name: '',
    },
    validators: {
      name: required(t('settings.sso.nameError')),
      idp_entity_id: required(t('settings.sso.entityIdError')),
      idp_sso_url: required(t('settings.sso.ssoUrlError')),
      idp_certificate_pem: required(t('settings.sso.certificateError')),
      verified_domains: required(t('settings.sso.verifiedDomainsError')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          name: values.name.trim(),
          idp_entity_id: values.idp_entity_id.trim(),
          idp_sso_url: values.idp_sso_url.trim(),
          idp_certificate_pem: values.idp_certificate_pem.trim(),
          verified_domains: parseVerifiedDomains(values.verified_domains),
          attribute_mapping: attributeMappingFrom(values),
          allow_idp_initiated: allowIdpInitiated,
          enabled: enabledOnCreate,
        });
        reset();
        setAllowIdpInitiated(false);
        setEnabledOnCreate(false);
        setVerifyResult(null);
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.details?.['entitlement'] === 'sso'
            ? t('settings.sso.entitlementError')
            : t(errorMessageKey(error)),
        );
      }
    },
  });
  const nameError = form.errorFor('name');
  const entityIdError = form.errorFor('idp_entity_id');
  const ssoUrlError = form.errorFor('idp_sso_url');
  const certificateError = form.errorFor('idp_certificate_pem');
  const verifiedDomainsError = form.errorFor('verified_domains');

  return (
    <Section title={t('settings.sso.title')} description={t('settings.sso.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.sso.loadError')} />
      ) : (
        <Card>
          {restricted && (
            <p className="border-b border-border p-4 text-2xs text-content-tertiary">
              {t('settings.sso.restrictedNote')}
            </p>
          )}

          {/* A refused switch rolls the checkbox back (`optimisticCacheUpdate`),
              which without this reads as the click not registering. Suppressed
              while the confirmation dialog is open, since it shows the same
              error where the person is looking. */}
          {toggle.isError && !enforceTarget && (
            <div className="border-b border-border p-4">
              <ErrorNotice message={t(errorMessageKey(toggle.error))} />
            </div>
          )}

          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="sso-name" className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.sso.nameLabel')}
                  </span>
                  <input
                    id="sso-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'sso-name-error' : undefined}
                    placeholder="Okta (corp)"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="sso-name-error" message={nameError} />
                </label>

                <label htmlFor="sso-entity-id" className="flex min-w-64 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.sso.entityIdLabel')}
                  </span>
                  <input
                    id="sso-entity-id"
                    value={form.values.idp_entity_id}
                    onChange={(event) => form.setValue('idp_entity_id', event.target.value)}
                    onBlur={() => form.blur('idp_entity_id')}
                    aria-invalid={entityIdError ? true : undefined}
                    aria-describedby={entityIdError ? 'sso-entity-id-error' : undefined}
                    placeholder="http://www.okta.com/exk1a2b3c4"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="sso-entity-id-error" message={entityIdError} />
                </label>

                <label htmlFor="sso-sso-url" className="flex min-w-64 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.sso.ssoUrlLabel')}
                  </span>
                  <input
                    id="sso-sso-url"
                    value={form.values.idp_sso_url}
                    onChange={(event) => form.setValue('idp_sso_url', event.target.value)}
                    onBlur={() => form.blur('idp_sso_url')}
                    aria-invalid={ssoUrlError ? true : undefined}
                    aria-describedby={ssoUrlError ? 'sso-sso-url-error' : undefined}
                    placeholder="https://corp.okta.com/app/.../sso/saml"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="sso-sso-url-error" message={ssoUrlError} />
                </label>
              </div>

              <label htmlFor="sso-certificate" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.sso.certificateLabel')}
                </span>
                <textarea
                  id="sso-certificate"
                  value={form.values.idp_certificate_pem}
                  onChange={(event) => form.setValue('idp_certificate_pem', event.target.value)}
                  onBlur={() => form.blur('idp_certificate_pem')}
                  aria-invalid={certificateError ? true : undefined}
                  aria-describedby={certificateError ? 'sso-certificate-error' : undefined}
                  placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
                  rows={4}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-2xs outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="sso-certificate-error" message={certificateError} />
              </label>

              {/* Required, and next to the certificate on purpose: the two
                  together are what decides *who* this identity provider may
                  speak for. Without the domains, an IdP could assert any
                  address on the internet and have it provisioned (PLAN §D116). */}
              {/* The hint is a sibling of the label rather than inside it: a
                  label's whole text content becomes the field's accessible
                  name, so a sentence of guidance in there would be read out
                  after "Verified domains" by every screen reader. It is bound
                  with `aria-describedby` instead, which is what describes. */}
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="sso-verified-domains"
                  className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                >
                  {t('settings.sso.verifiedDomainsLabel')}
                </label>
                <input
                  id="sso-verified-domains"
                  value={form.values.verified_domains}
                  onChange={(event) => form.setValue('verified_domains', event.target.value)}
                  onBlur={() => form.blur('verified_domains')}
                  aria-invalid={verifiedDomainsError ? true : undefined}
                  aria-describedby={
                    verifiedDomainsError
                      ? 'sso-verified-domains-hint sso-verified-domains-error'
                      : 'sso-verified-domains-hint'
                  }
                  placeholder="acme.com, corp.acme.com"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
                <span id="sso-verified-domains-hint" className="text-2xs text-content-tertiary">
                  {t('settings.sso.verifiedDomainsHint')}
                </span>
                <FieldError id="sso-verified-domains-error" message={verifiedDomainsError} />
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <label
                  htmlFor="sso-attribute-email"
                  className="flex min-w-48 flex-1 flex-col gap-1"
                >
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.sso.emailAttributeLabel')}
                  </span>
                  <input
                    id="sso-attribute-email"
                    value={form.values.attribute_email}
                    onChange={(event) => form.setValue('attribute_email', event.target.value)}
                    placeholder="urn:oid:0.9.2342.19200300.100.1.3"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>

                <label htmlFor="sso-attribute-name" className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.sso.nameAttributeLabel')}
                  </span>
                  <input
                    id="sso-attribute-name"
                    value={form.values.attribute_name}
                    onChange={(event) => form.setValue('attribute_name', event.target.value)}
                    placeholder="displayName"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-content-secondary">
                  <input
                    type="checkbox"
                    checked={allowIdpInitiated}
                    onChange={(event) => setAllowIdpInitiated(event.target.checked)}
                  />
                  {t('settings.sso.allowIdpInitiatedLabel')}
                </label>
                <label className="flex items-center gap-2 text-sm text-content-secondary">
                  <input
                    type="checkbox"
                    checked={enabledOnCreate}
                    onChange={(event) => setEnabledOnCreate(event.target.checked)}
                  />
                  {t('settings.sso.enableImmediatelyLabel')}
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setVerifyResult(
                      verifySsoMetadata({
                        idp_entity_id: form.values.idp_entity_id,
                        idp_sso_url: form.values.idp_sso_url,
                        idp_certificate_pem: form.values.idp_certificate_pem,
                        verified_domains: form.values.verified_domains,
                        attribute_email: form.values.attribute_email,
                        attribute_name: form.values.attribute_name,
                      }),
                    )
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2"
                >
                  {t('settings.sso.verifyButton')}
                </button>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? t('settings.adding') : t('settings.sso.addButton')}
                </button>
              </div>

              <p className="text-2xs text-content-tertiary">{t('settings.sso.verifyHint')}</p>

              {verifyResult && (
                <div
                  role="status"
                  className={`rounded-md border px-3 py-2 text-2xs ${
                    verifyResult.ok
                      ? 'border-success/40 text-success'
                      : 'border-warning/40 text-warning'
                  }`}
                >
                  {verifyResult.ok ? (
                    t('settings.sso.verifyOk')
                  ) : (
                    <ul className="list-disc pl-4">
                      {verifyResult.problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {form.submitError && (
                <p role="alert" className="text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.sso.empty.title')}
              description={t('settings.sso.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((connection) => (
                <li key={connection.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {connection.name}
                      <StatusDot
                        tone={connection.enabled ? 'success' : 'neutral'}
                        label={
                          connection.enabled
                            ? t('settings.sso.enabledStatus')
                            : t('settings.sso.disabledStatus')
                        }
                      />
                    </p>
                    <p className="truncate text-2xs text-content-tertiary">
                      {connection.idp_entity_id}
                    </p>
                    <p className="truncate font-mono text-2xs text-content-tertiary">
                      {connection.idp_sso_url}
                    </p>
                    {/* Claiming a domain and proving it are two acts (§D134),
                        and the gap between them is exactly the state an owner
                        needs to see: a connection whose domains are all still
                        pending provisions nobody, and a summary line listing the
                        claims would read as if it did. */}
                    {connection.verified_domains.length > 0 && (
                      <p className="truncate text-2xs text-content-tertiary">
                        {t('settings.sso.verifiedDomainsSummary', {
                          domains: connection.verified_domains.join(', '),
                        })}
                      </p>
                    )}
                    {connection.domains.length > 0 && (
                      <DomainProofs
                        connection={connection}
                        canEdit={canEdit}
                        onChanged={invalidate}
                      />
                    )}
                    {connection.previous_certificate_expires_at && (
                      <p className="text-2xs text-warning">
                        {t('settings.sso.rotationOverlapNote', {
                          date: formatDate(connection.previous_certificate_expires_at) ?? '',
                        })}
                      </p>
                    )}
                    {/* Two sentences for two different states, because the
                        difference decides whether anybody can sign in with a
                        password right now. A connection that is required but
                        switched off enforces nothing — the server reads the
                        pair, and hiding that would leave an owner reading
                        "Required" while passwords quietly still work. */}
                    {connection.enforced && (
                      <p className="text-2xs text-warning">
                        {connection.enabled
                          ? t('settings.sso.enforcedActiveNote')
                          : t('settings.sso.enforcedInactiveNote')}
                      </p>
                    )}
                  </div>

                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-2">
                      <label className="flex items-center gap-1.5 text-2xs text-content-secondary">
                        <input
                          type="checkbox"
                          checked={connection.enabled}
                          disabled={toggle.isPending}
                          onChange={(event) =>
                            toggle.mutate({ id: connection.id, enabled: event.target.checked })
                          }
                        />
                        {t('settings.sso.enabledCheckboxLabel')}
                      </label>
                      <label className="flex items-center gap-1.5 text-2xs text-content-secondary">
                        <input
                          type="checkbox"
                          checked={connection.enforced}
                          disabled={toggle.isPending}
                          onChange={(event) => {
                            if (event.target.checked) setEnforceTarget(connection);
                            else toggle.mutate({ id: connection.id, enforced: false });
                          }}
                        />
                        {t('settings.sso.requireSsoLabel')}
                      </label>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(connection)}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.remove')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {enforceTarget && (
        <Modal
          onClose={() => setEnforceTarget(null)}
          title={t('settings.sso.enforceModalTitle', { name: enforceTarget.name })}
          description={t('settings.sso.enforceModalDescription')}
        >
          {/* The server refuses this when no owner holds a password — the
              self-lockout guard. Its message names what to fix, so it is shown
              verbatim rather than replaced with something vaguer. */}
          {toggle.isError && (
            <ErrorNotice
              message={
                toggle.error instanceof ApiClientError
                  ? // i18n-ignore — self-lockout guard names the exact fix (set a password on the owner account); genericizing would strand the one person who can act on it (S11-h).
                    toggle.error.message
                  : t('settings.sso.requireErrorFallback')
              }
            />
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEnforceTarget(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => toggle.mutate({ id: enforceTarget.id, enforced: true })}
              disabled={toggle.isPending}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {toggle.isPending ? t('settings.sso.requiring') : t('settings.sso.requireButton')}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          onClose={() => setDeleteTarget(null)}
          title={t('settings.sso.removeModalTitle', { name: deleteTarget.name })}
          description={t('settings.sso.removeModalDescription')}
        >
          {remove.isError && <ErrorNotice message={t(errorMessageKey(remove.error))} />}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
              className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {remove.isPending
                ? t('settings.sso.removing')
                : t('settings.sso.removeConfirmButton')}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

// --- SCIM provisioning tokens ---------------------------------------------------

function ScimTokens({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [created, setCreated] = useState<ScimTokenCreated | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ScimTokenRecord | null>(null);

  const list = useQuery({
    queryKey: ['settings', 'scim-tokens'],
    queryFn: () => api.get<{ items: ScimTokenRecord[] }>('/settings/scim-tokens'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'scim-tokens'] });

  const create = useMutation({
    mutationFn: (body: { name: string; expires_in_days?: number }) =>
      api.post<ScimTokenCreated>('/settings/scim-tokens', body),
    onSuccess: (data) => {
      setCreated(data);
      invalidate();
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/settings/scim-tokens/${id}`),
    onSuccess: () => {
      setRevokeTarget(null);
      invalidate();
    },
  });

  const form = useForm({
    initial: { name: '', expires_in_days: '' },
    validators: { name: required(t('settings.scim.tokenNameError')) },
    onSubmit: async (values, { setSubmitError, reset }) => {
      const days = values.expires_in_days.trim();
      let expiresInDays: number | undefined;
      if (days !== '') {
        const parsed = Number(days);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
          setSubmitError(t('settings.scim.expiryRangeError'));
          return;
        }
        expiresInDays = parsed;
      }
      try {
        await create.mutateAsync({
          name: values.name.trim(),
          ...(expiresInDays === undefined ? {} : { expires_in_days: expiresInDays }),
        });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const nameError = form.errorFor('name');

  return (
    <Section title={t('settings.scim.title')} description={t('settings.scim.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.scim.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="scim-token-name" className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.scim.tokenNameLabel')}
                  </span>
                  <input
                    id="scim-token-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'scim-token-name-error' : undefined}
                    placeholder="Okta (corp) provisioning"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="scim-token-name-error" message={nameError} />
                </label>

                <label htmlFor="scim-token-expiry" className="flex w-40 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.scim.expiresInLabel')}
                  </span>
                  <input
                    id="scim-token-expiry"
                    type="number"
                    min={1}
                    max={365}
                    value={form.values.expires_in_days}
                    onChange={(event) => form.setValue('expires_in_days', event.target.value)}
                    placeholder={t('settings.never')}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting
                    ? t('settings.scim.creating')
                    : t('settings.scim.createButton')}
                </button>
              </div>

              {form.submitError && (
                <p role="alert" className="text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.scim.empty.title')}
              description={t('settings.scim.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((token) => (
                <li key={token.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {token.name ?? t('settings.scim.untitledToken')}
                    </p>
                    <p className="text-2xs text-content-tertiary">
                      {token.last_used_at
                        ? t('settings.scim.lastUsed', {
                            date: formatDate(token.last_used_at) ?? '',
                          })
                        : t('settings.scim.neverUsed')}
                      {' · '}
                      {token.expires_at
                        ? t('settings.scim.expires', { date: formatDate(token.expires_at) ?? '' })
                        : t('settings.scim.noExpiry')}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(token)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('settings.scim.revokeButton')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {created && <ScimTokenOncePanel created={created} onClose={() => setCreated(null)} />}

      {revokeTarget && (
        <Modal
          onClose={() => setRevokeTarget(null)}
          title={t('settings.scim.revokeModalTitle', {
            name: revokeTarget.name ?? t('settings.scim.revokeModalDefaultName'),
          })}
          description={t('settings.scim.revokeModalDescription')}
        >
          {revoke.isError && <ErrorNotice message={t(errorMessageKey(revoke.error))} />}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRevokeTarget(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              {t('settings.cancel')}
            </button>
            <button
              type="button"
              onClick={() => revoke.mutate(revokeTarget.id)}
              disabled={revoke.isPending}
              className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {revoke.isPending
                ? t('settings.scim.revoking')
                : t('settings.scim.revokeConfirmButton')}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

/**
 * The one place a SCIM token's plaintext is ever rendered — same contract as
 * `DeveloperPortal.tsx`'s `SecretOncePanel`: it lives only in this component's
 * state, and closing the panel (Done, Escape or the backdrop, all routed
 * through `onClose`) drops that state. There is no other copy to leak.
 */
function ScimTokenOncePanel({
  created,
  onClose,
}: {
  created: ScimTokenCreated;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard?.writeText(created.token).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  }

  return (
    <Modal
      onClose={onClose}
      title={t('settings.scim.tokenCreatedTitle', {
        name: created.name ?? t('settings.scim.defaultTokenName'),
      })}
      description={t('settings.scim.tokenCreatedDescription')}
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.scim.bearerTokenLabel')}
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
              {created.token}
            </code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600"
            >
              {copied ? t('settings.copied') : t('settings.copy')}
            </button>
          </div>
          <p role="alert" className="text-2xs text-warning">
            {t('settings.scim.tokenWarning')}
          </p>
        </div>

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('settings.scim.doneButton')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
