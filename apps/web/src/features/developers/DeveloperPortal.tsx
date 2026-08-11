/**
 * Developer portal — FR-MOD-09.4 (v2, Could). "Build your own app": a shell
 * over `/partner/apps` (09.4-c register/list/delete, 09.4-d rotate) with two
 * more tabs (09.4-f) — webhook subscriptions and the integration manifest,
 * both in `WebhookSubscriptions.tsx`. This screen is a pure contract
 * consumer — every real rule (redirect URI shape, the scope ceiling,
 * cross-tenant isolation) is enforced server-side; a 400 or 403 here is
 * shown, never second-guessed.
 *
 * Every secret this screen ever shows — a fresh registration's, a rotation's —
 * exists in the browser for exactly one render: the value lives only in
 * component state, shown once in `SecretOncePanel`, and is discarded — not
 * merely hidden — the moment that panel closes. The list itself never carries
 * one; the server response it reads never includes one (`SAFE_SELECT` on the
 * API side never selects `secretHash`).
 *
 * Visible only to `access_rules:rw` (owner/admin) — the same scope every
 * write on this surface requires, so a teammate without it would only ever
 * find doors that 403. Mirrors the audit log screen's pattern (`AuditLogPage`):
 * a courtesy hide, not the boundary — the route itself carries the real gate.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SCOPES } from '@nexa/types';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { FieldError, required, splitList, useForm, type Validator } from '../../lib/form.js';
import { IntegrationManifestReference, WebhookSubscriptions } from './WebhookSubscriptions.js';

const PARTNER_APPS_KEY = ['developers', 'partner-apps'] as const;

const TABS = [
  { id: 'apps', label: 'Apps' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'manifest', label: 'Manifest' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type PartnerAppClientType = 'public' | 'confidential';

interface PartnerApp {
  client_id: string;
  display_name: string;
  client_type: PartnerAppClientType;
  redirect_uris: string[];
  scopes: string[];
  created_at: string;
}

/** The register response — a `PartnerApp` plus its secret, present once and
 *  only for a confidential client. */
interface PartnerAppRegistration extends PartnerApp {
  client_secret?: string;
}

/** The rotate response — always carries the new secret (rotation only ever
 *  applies to a confidential client; a public one has none to reissue). */
interface PartnerAppSecretRotation extends PartnerApp {
  client_secret: string;
}

/** The textarea holds one redirect URI per line; at least one is required.
 *  The URI's own shape (absolute, https, canonical form…) is the server's
 *  call — `validateRedirectUri` — so this only checks something was entered. */
function redirectUrisRequired(
  message = 'Enter at least one redirect URI, one per line.',
): Validator {
  return (value) => (splitList(value).length > 0 ? null : message);
}

export function DeveloperPortalPage(): ReactElement {
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canManage = scopes.includes('access_rules:rw');

  if (!canManage) {
    return (
      <Page
        title="Developers"
        description="Register OAuth apps that can act on this workspace through the API."
      >
        <EmptyState
          title="Developer portal not available"
          description="Registering apps is limited to owners and admins with write access to this workspace's access rules."
        />
      </Page>
    );
  }

  return <DeveloperPortalContent />;
}

function DeveloperPortalContent(): ReactElement {
  const api = useApiClient();
  const [tab, setTab] = useState<TabId>('apps');
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newRegistration, setNewRegistration] = useState<PartnerAppRegistration | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartnerApp | null>(null);
  const [rotateTarget, setRotateTarget] = useState<PartnerApp | null>(null);
  const [newSecretRotation, setNewSecretRotation] = useState<PartnerAppSecretRotation | null>(null);

  const list = useQuery({
    queryKey: PARTNER_APPS_KEY,
    queryFn: () => api.get<{ items: PartnerApp[] }>('/partner/apps'),
  });

  const registerButton = (
    <button
      type="button"
      onClick={() => setRegisterOpen(true)}
      className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
    >
      Register app
    </button>
  );

  return (
    <Page
      title="Developers"
      description="Register OAuth apps that can act on this workspace through the API."
      actions={tab === 'apps' ? registerButton : undefined}
    >
      <div
        role="tablist"
        aria-label="Developer portal"
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((tabDef) => {
          const selected = tab === tabDef.id;
          return (
            <button
              key={tabDef.id}
              type="button"
              role="tab"
              id={`developer-portal-tab-${tabDef.id}`}
              aria-selected={selected}
              aria-controls={`developer-portal-panel-${tabDef.id}`}
              onClick={() => setTab(tabDef.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? 'border-brand-500 text-content'
                  : 'border-transparent text-content-secondary hover:text-content'
              }`}
            >
              {tabDef.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`developer-portal-panel-${tab}`}
        aria-labelledby={`developer-portal-tab-${tab}`}
        className="flex flex-col gap-6"
      >
        {tab === 'apps' && (
          <Section
            title="Partner apps"
            description="Apps your team has registered, and what each one may do on this workspace."
          >
            {list.error ? (
              <ErrorNotice message="Could not load your partner apps." />
            ) : (
              <Card>
                {list.isPending ? (
                  <p className="p-4 text-sm text-content-secondary">Loading…</p>
                ) : list.data.items.length === 0 ? (
                  <EmptyState
                    title="No partner apps yet"
                    description="Register an OAuth client to let a script, a Zap, or a service you build call the Nexa API on this workspace's behalf."
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {list.data.items.map((app) => (
                      <AppRow
                        key={app.client_id}
                        app={app}
                        onDelete={() => setDeleteTarget(app)}
                        onRotate={() => setRotateTarget(app)}
                      />
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </Section>
        )}

        {tab === 'webhooks' && <WebhookSubscriptions canEdit />}
        {tab === 'manifest' && <IntegrationManifestReference />}
      </div>

      {registerOpen && (
        <RegisterAppModal
          onClose={() => setRegisterOpen(false)}
          onRegistered={(registration) => {
            setRegisterOpen(false);
            setNewRegistration(registration);
          }}
        />
      )}

      {/* The secret lives only here. Closing the panel drops this state, not
          just the dialog — there is no other copy to leak. */}
      {newRegistration && (
        <SecretOncePanel
          title={`${newRegistration.display_name} registered`}
          registration={newRegistration}
          onClose={() => setNewRegistration(null)}
        />
      )}

      {deleteTarget && <DeleteAppModal app={deleteTarget} onClose={() => setDeleteTarget(null)} />}

      {rotateTarget && (
        <RotateSecretModal
          app={rotateTarget}
          onClose={() => setRotateTarget(null)}
          onRotated={(rotation) => {
            setRotateTarget(null);
            setNewSecretRotation(rotation);
          }}
        />
      )}

      {/* Same one-render discipline as a fresh registration's secret. */}
      {newSecretRotation && (
        <SecretOncePanel
          title={`${newSecretRotation.display_name} secret rotated`}
          registration={newSecretRotation}
          onClose={() => setNewSecretRotation(null)}
        />
      )}
    </Page>
  );
}

function AppRow({
  app,
  onDelete,
  onRotate,
}: {
  app: PartnerApp;
  onDelete: () => void;
  onRotate: () => void;
}): ReactElement {
  return (
    <li data-testid={`partner-app-${app.client_id}`} className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.display_name}</span>
        <span className="self-start rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {app.client_type === 'confidential' ? 'Confidential' : 'Public'}
        </span>
        {/* A public client authenticates with PKCE alone and has no secret to
            reissue (server 400s it) — hiding the button here is a known,
            client-side-only fact, not a second guess of a workspace decision. */}
        {app.client_type === 'confidential' && (
          <button
            type="button"
            onClick={onRotate}
            aria-label={`Rotate secret for ${app.display_name}`}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
          >
            Rotate secret
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${app.display_name}`}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          Delete
        </button>
      </div>

      <code className="truncate text-2xs text-content-tertiary" title={app.client_id}>
        {app.client_id}
      </code>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-content-tertiary">
        <span>
          {app.redirect_uris.length} redirect URI{app.redirect_uris.length === 1 ? '' : 's'}
        </span>
        <span className="truncate" title={app.scopes.join(', ')}>
          {app.scopes.length} scope{app.scopes.length === 1 ? '' : 's'}
        </span>
        <span>{formatDateTime(app.created_at)}</span>
      </div>
    </li>
  );
}

function RegisterAppModal({
  onClose,
  onRegistered,
}: {
  onClose: () => void;
  onRegistered: (registration: PartnerAppRegistration) => void;
}): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [clientType, setClientType] = useState<PartnerAppClientType>('public');
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  const register = useMutation({
    mutationFn: (body: {
      display_name: string;
      client_type: PartnerAppClientType;
      redirect_uris: string[];
      scopes: string[];
    }) => api.post<PartnerAppRegistration>('/partner/apps', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PARTNER_APPS_KEY });
    },
  });

  const form = useForm({
    initial: { display_name: '', redirect_uris: '' },
    validators: {
      display_name: required('Enter a name for this app.'),
      redirect_uris: redirectUrisRequired(),
    },
    onSubmit: async (values, { setSubmitError }) => {
      // The one rule this screen enforces itself rather than round-tripping to
      // the server for: an empty scope set is caught here for the same reason
      // `narrowScopes` refuses it there — a client with no scopes is unbounded,
      // not restricted, so it is never a state Submit should allow reaching.
      if (scopes.size === 0) {
        setSubmitError('Select at least one scope.');
        return;
      }
      try {
        const registration = await register.mutateAsync({
          display_name: values.display_name.trim(),
          client_type: clientType,
          redirect_uris: splitList(values.redirect_uris),
          scopes: [...scopes],
        });
        onRegistered(registration);
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not register that app.',
        );
      }
    },
  });

  const nameError = form.errorFor('display_name');
  const urisError = form.errorFor('redirect_uris');
  const canSubmit = form.canSubmit && scopes.size > 0;

  function toggleScope(scope: string): void {
    setScopes((current) => {
      const next = new Set(current);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  return (
    <Modal
      onClose={onClose}
      title="Register app"
      description="Register an OAuth client that can act on this workspace through the API."
      className="w-[30rem]"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        <label htmlFor="partner-app-name" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            App name
          </span>
          <input
            id="partner-app-name"
            value={form.values.display_name}
            onChange={(event) => form.setValue('display_name', event.target.value)}
            onBlur={() => form.blur('display_name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'partner-app-name-error' : undefined}
            placeholder="Acme Zap Connector"
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="partner-app-name-error" message={nameError} />
        </label>

        <label htmlFor="partner-app-client-type" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Client type
          </span>
          <select
            id="partner-app-client-type"
            value={clientType}
            onChange={(event) => setClientType(event.target.value as PartnerAppClientType)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            <option value="public">Public (PKCE, no secret)</option>
            <option value="confidential">Confidential (issues a secret)</option>
          </select>
        </label>

        <label htmlFor="partner-app-redirect-uris" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Redirect URIs
          </span>
          <textarea
            id="partner-app-redirect-uris"
            rows={3}
            value={form.values.redirect_uris}
            onChange={(event) => form.setValue('redirect_uris', event.target.value)}
            onBlur={() => form.blur('redirect_uris')}
            aria-invalid={urisError ? true : undefined}
            aria-describedby={urisError ? 'partner-app-redirect-uris-error' : undefined}
            placeholder={'https://example.com/oauth/callback'}
            className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-2xs outline-none placeholder:text-content-tertiary"
          />
        </label>
        {/* Kept outside the label — nested prose here would fold into the
            label's accessible name (`getByLabelText('Redirect URIs')` would
            stop matching), the same reason InviteTeammates keeps its hint
            text out of the label too. */}
        <FieldError id="partner-app-redirect-uris-error" message={urisError} />
        <p className="-mt-2 text-2xs text-content-tertiary">One URI per line.</p>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Scopes
          </legend>
          <p className="text-2xs text-content-tertiary">
            Only scopes your own session already holds can be granted to the app.
          </p>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {SCOPES.map((scope) => (
              <li key={scope}>
                <label className="flex items-center gap-2 text-2xs">
                  <input
                    type="checkbox"
                    checked={scopes.has(scope)}
                    onChange={() => toggleScope(scope)}
                  />
                  <code>{scope}</code>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {form.submitError && (
          <p role="alert" className="text-2xs text-danger">
            {form.submitError}
          </p>
        )}

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting ? 'Registering…' : 'Register'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The secret-once panel (KK "secret bir kez") — shared by register and rotate,
 * the only two responses that ever carry a `client_secret`. It renders that
 * value with a copy button and an explicit "won't be shown again" warning.
 * Closing it (Done, Escape, or a backdrop click, all routed through
 * `onClose`) is what discards the secret from state; nothing here persists it
 * anywhere else.
 */
function SecretOncePanel({
  title,
  registration,
  onClose,
}: {
  title: string;
  registration: PartnerAppRegistration;
  onClose: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  function copy(): void {
    if (!registration.client_secret) return;
    void navigator.clipboard?.writeText(registration.client_secret).then(
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
      title={title}
      description="Save these credentials now."
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Client ID
          </span>
          <code className="truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
            {registration.client_id}
          </code>
        </div>

        {registration.client_secret && (
          <div className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              Client secret
            </span>
            <div className="flex items-center gap-2">
              <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
                {registration.client_secret}
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
              This secret will not be shown again — store it now.
            </p>
          </div>
        )}

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

function DeleteAppModal({ app, onClose }: { app: PartnerApp; onClose: () => void }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/partner/apps/${app.client_id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PARTNER_APPS_KEY });
      onClose();
    },
  });

  return (
    <Modal
      onClose={onClose}
      title={`Delete ${app.display_name}?`}
      description="Any live tokens this app holds stop working immediately. This cannot be undone."
    >
      {remove.isError && (
        <ErrorNotice
          message={
            remove.error instanceof ApiClientError
              ? remove.error.message
              : 'Could not delete that app.'
          }
        />
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {remove.isPending ? 'Deleting…' : 'Delete app'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Re-key a confidential client (09.4-d's `rotate-secret` action, surfaced
 * here in 09.4-f): a confirm step, since the previous secret dies the instant
 * this commits — no overlap window, no undo. Success hands the new
 * `PartnerAppSecretRotation` up to `SecretOncePanel`, the only place it is
 * ever shown.
 */
function RotateSecretModal({
  app,
  onClose,
  onRotated,
}: {
  app: PartnerApp;
  onClose: () => void;
  onRotated: (rotation: PartnerAppSecretRotation) => void;
}): ReactElement {
  const api = useApiClient();

  const rotate = useMutation({
    mutationFn: () =>
      api.post<PartnerAppSecretRotation>(`/partner/apps/${app.client_id}/rotate-secret`),
    onSuccess: (rotation) => onRotated(rotation),
  });

  return (
    <Modal
      onClose={onClose}
      title={`Rotate secret for ${app.display_name}?`}
      description="The current secret stops working immediately. Update every integration that uses it with the new one."
    >
      {rotate.isError && (
        <ErrorNotice
          message={
            rotate.error instanceof ApiClientError
              ? rotate.error.message
              : 'Could not rotate that secret.'
          }
        />
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => rotate.mutate()}
          disabled={rotate.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {rotate.isPending ? 'Rotating…' : 'Rotate secret'}
        </button>
      </div>
    </Modal>
  );
}
