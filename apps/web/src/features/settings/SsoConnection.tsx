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
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { formatDate } from '../../lib/format.js';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';

interface SsoAttributeMapping {
  email?: string;
  name?: string;
}

interface SsoConnectionRecord {
  id: string;
  name: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
  previous_certificate_pem: string | null;
  previous_certificate_expires_at: string | null;
  attribute_mapping: SsoAttributeMapping;
  allow_idp_initiated: boolean;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface CreateSsoConnectionBody {
  name: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
  attribute_mapping?: SsoAttributeMapping;
  allow_idp_initiated: boolean;
  enabled: boolean;
}

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
 * Local-only checks (no network request) for the metadata form: does the
 * certificate parse, are the entity id and sign-on URL well-formed, and — if
 * an attribute mapping is being configured at all — does it name the email
 * claim JIT provisioning matches accounts on.
 */
export function verifySsoMetadata(values: {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate_pem: string;
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

function SsoConnections({
  canEdit,
  restricted,
}: {
  canEdit: boolean;
  /** Scope allows writing but the role does not — explain the empty form, not just omit it. */
  restricted: boolean;
}): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [allowIdpInitiated, setAllowIdpInitiated] = useState(false);
  const [enabledOnCreate, setEnabledOnCreate] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SsoMetadataCheck | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SsoConnectionRecord | null>(null);

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
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<SsoConnectionRecord>(`/settings/sso/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: SsoConnectionRecord[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'sso'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((c) => (c.id === id ? { ...c, enabled } : c)),
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
      attribute_email: '',
      attribute_name: '',
    },
    validators: {
      name: required('Name this connection.'),
      idp_entity_id: required('Enter the IdP entity id.'),
      idp_sso_url: required('Enter the IdP sign-on URL.'),
      idp_certificate_pem: required('Paste the IdP certificate.'),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          name: values.name.trim(),
          idp_entity_id: values.idp_entity_id.trim(),
          idp_sso_url: values.idp_sso_url.trim(),
          idp_certificate_pem: values.idp_certificate_pem.trim(),
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
          error instanceof ApiClientError ? error.message : 'Could not save that connection.',
        );
      }
    },
  });
  const nameError = form.errorFor('name');
  const entityIdError = form.errorFor('idp_entity_id');
  const ssoUrlError = form.errorFor('idp_sso_url');
  const certificateError = form.errorFor('idp_certificate_pem');

  return (
    <Section
      title="Single sign-on"
      description="Federate sign-in to a SAML 2.0 identity provider. Adding or changing a connection is restricted to the workspace owner — writing the certificate here decides whose signature is trusted."
    >
      {list.error ? (
        <ErrorNotice message="Could not load SSO connections." />
      ) : (
        <Card>
          {restricted && (
            <p className="border-b border-border p-4 text-2xs text-content-tertiary">
              Only the workspace owner can add, rotate or remove a connection.
            </p>
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
                    Name
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
                    IdP entity id
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
                    Sign-on URL
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
                  IdP signing certificate (PEM)
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

              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="sso-attribute-email" className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Email attribute (optional)
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
                    Name attribute (optional)
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
                  Allow IdP-initiated sign-in
                </label>
                <label className="flex items-center gap-2 text-sm text-content-secondary">
                  <input
                    type="checkbox"
                    checked={enabledOnCreate}
                    onChange={(event) => setEnabledOnCreate(event.target.checked)}
                  />
                  Enable immediately
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
                        attribute_email: form.values.attribute_email,
                        attribute_name: form.values.attribute_name,
                      }),
                    )
                  }
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2"
                >
                  Verify format
                </button>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Adding…' : 'Add connection'}
                </button>
              </div>

              <p className="text-2xs text-content-tertiary">
                Verify format checks the certificate, entity id and URL locally — it never
                contacts the identity provider.
              </p>

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
                    'Looks well-formed.'
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
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No SSO connections"
              description="Add your identity provider's metadata to let its members sign in with SAML."
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
                        label={connection.enabled ? 'Enabled' : 'Disabled'}
                      />
                    </p>
                    <p className="truncate text-2xs text-content-tertiary">
                      {connection.idp_entity_id}
                    </p>
                    <p className="truncate font-mono text-2xs text-content-tertiary">
                      {connection.idp_sso_url}
                    </p>
                    {connection.previous_certificate_expires_at && (
                      <p className="text-2xs text-warning">
                        Rotation overlap active until{' '}
                        {formatDate(connection.previous_certificate_expires_at)}
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
                        Enabled
                      </label>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(connection)}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {deleteTarget && (
        <Modal
          onClose={() => setDeleteTarget(null)}
          title={`Remove ${deleteTarget.name}?`}
          description="Anyone who signs in through this connection loses that path immediately. This cannot be undone."
        >
          {remove.isError && (
            <ErrorNotice
              message={
                remove.error instanceof ApiClientError
                  ? remove.error.message
                  : 'Could not remove that connection.'
              }
            />
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(deleteTarget.id)}
              disabled={remove.isPending}
              className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {remove.isPending ? 'Removing…' : 'Remove connection'}
            </button>
          </div>
        </Modal>
      )}
    </Section>
  );
}

// --- SCIM provisioning tokens ---------------------------------------------------

function ScimTokens({ canEdit }: { canEdit: boolean }): ReactElement {
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
    validators: { name: required('Name this token.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      const days = values.expires_in_days.trim();
      let expiresInDays: number | undefined;
      if (days !== '') {
        const parsed = Number(days);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
          setSubmitError('Expiry must be a whole number of days, 1 to 365.');
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
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not create that token.',
        );
      }
    },
  });
  const nameError = form.errorFor('name');

  return (
    <Section
      title="SCIM provisioning"
      description="Bearer tokens for your identity provider's SCIM connector. A token is shown once, at creation, then never again."
    >
      {list.error ? (
        <ErrorNotice message="Could not load provisioning tokens." />
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
                    Token name
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
                    Expires in (days)
                  </span>
                  <input
                    id="scim-token-expiry"
                    type="number"
                    min={1}
                    max={365}
                    value={form.values.expires_in_days}
                    onChange={(event) => form.setValue('expires_in_days', event.target.value)}
                    placeholder="Never"
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Creating…' : 'Create token'}
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
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No provisioning tokens"
              description="Create one to paste into your identity provider's SCIM connector."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((token) => (
                <li key={token.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{token.name ?? 'Untitled token'}</p>
                    <p className="text-2xs text-content-tertiary">
                      {token.last_used_at
                        ? `Last used ${formatDate(token.last_used_at)}`
                        : 'Never used'}
                      {' · '}
                      {token.expires_at ? `Expires ${formatDate(token.expires_at)}` : 'No expiry'}
                    </p>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(token)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Revoke
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
          title={`Revoke ${revokeTarget.name ?? 'this token'}?`}
          description="Your identity provider's connector stops being able to provision or deprovision users the moment this takes effect. This cannot be undone."
        >
          {revoke.isError && (
            <ErrorNotice
              message={
                revoke.error instanceof ApiClientError
                  ? revoke.error.message
                  : 'Could not revoke that token.'
              }
            />
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRevokeTarget(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => revoke.mutate(revokeTarget.id)}
              disabled={revoke.isPending}
              className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {revoke.isPending ? 'Revoking…' : 'Revoke token'}
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
      title={`${created.name ?? 'Token'} created`}
      description="Paste this into your identity provider's SCIM connector now."
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Bearer token
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
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p role="alert" className="text-2xs text-warning">
            This token will not be shown again — store it now.
          </p>
        </div>

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
