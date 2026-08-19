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
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { FieldError, required, splitList, useForm, type Validator } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { IntegrationManifestReference, WebhookSubscriptions } from './WebhookSubscriptions.js';

const PARTNER_APPS_KEY = ['developers', 'partner-apps'] as const;

const TAB_LABEL_KEYS = {
  apps: 'apps.developers.tabs.apps',
  webhooks: 'apps.developers.tabs.webhooks',
  manifest: 'apps.developers.tabs.manifest',
} as const;
const TABS = ['apps', 'webhooks', 'manifest'] as const;
type TabId = (typeof TABS)[number];

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
function redirectUrisRequired(message: string): Validator {
  return (value) => (splitList(value).length > 0 ? null : message);
}

export function DeveloperPortalPage(): ReactElement {
  const t = useTranslate();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canManage = scopes.includes('access_rules:rw');

  if (!canManage) {
    return (
      <Page
        title={t('apps.developers.page.title')}
        description={t('apps.developers.page.description')}
      >
        <EmptyState
          title={t('apps.developers.notAvailable.title')}
          description={t('apps.developers.notAvailable.description')}
        />
      </Page>
    );
  }

  return <DeveloperPortalContent />;
}

function DeveloperPortalContent(): ReactElement {
  const api = useApiClient();
  const t = useTranslate();
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
      {t('apps.developers.registerApp')}
    </button>
  );

  return (
    <Page
      title={t('apps.developers.page.title')}
      description={t('apps.developers.page.description')}
      actions={tab === 'apps' ? registerButton : undefined}
    >
      <div
        role="tablist"
        aria-label={t('apps.developers.tablistLabel')}
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((tabId) => {
          const selected = tab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              role="tab"
              id={`developer-portal-tab-${tabId}`}
              aria-selected={selected}
              aria-controls={`developer-portal-panel-${tabId}`}
              onClick={() => setTab(tabId)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                selected
                  ? 'border-brand-500 text-content'
                  : 'border-transparent text-content-secondary hover:text-content'
              }`}
            >
              {t(TAB_LABEL_KEYS[tabId])}
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
            title={t('apps.developers.partnerApps.title')}
            description={t('apps.developers.partnerApps.description')}
          >
            {list.error ? (
              <ErrorNotice message={t('apps.developers.partnerApps.loadError')} />
            ) : (
              <Card>
                {list.isPending ? (
                  <p className="p-4 text-sm text-content-secondary">{t('apps.common.loading')}</p>
                ) : list.data.items.length === 0 ? (
                  <EmptyState
                    title={t('apps.developers.partnerApps.emptyTitle')}
                    description={t('apps.developers.partnerApps.emptyDescription')}
                  />
                ) : (
                  <ul className="divide-y divide-border">
                    {list.data.items.map((app) => (
                      <AppRow
                        key={app.client_id}
                        app={app}
                        t={t}
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
          title={t('apps.developers.secret.registeredTitle', {
            name: newRegistration.display_name,
          })}
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
          title={t('apps.developers.secret.rotatedTitle', { name: newSecretRotation.display_name })}
          registration={newSecretRotation}
          onClose={() => setNewSecretRotation(null)}
        />
      )}
    </Page>
  );
}

function AppRow({
  app,
  t,
  onDelete,
  onRotate,
}: {
  app: PartnerApp;
  t: TFunction;
  onDelete: () => void;
  onRotate: () => void;
}): ReactElement {
  return (
    <li data-testid={`partner-app-${app.client_id}`} className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.display_name}</span>
        <span className="self-start rounded-sm bg-inset px-1.5 py-0.5 text-2xs text-content-secondary">
          {app.client_type === 'confidential'
            ? t('apps.developers.clientType.confidential')
            : t('apps.developers.clientType.public')}
        </span>
        {/* A public client authenticates with PKCE alone and has no secret to
            reissue (server 400s it) — hiding the button here is a known,
            client-side-only fact, not a second guess of a workspace decision. */}
        {app.client_type === 'confidential' && (
          <button
            type="button"
            onClick={onRotate}
            aria-label={t('apps.developers.rotateSecretFor', { name: app.display_name })}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
          >
            {t('apps.developers.rotateSecret')}
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label={t('apps.developers.deleteFor', { name: app.display_name })}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('apps.developers.delete')}
        </button>
      </div>

      <code className="truncate text-2xs text-content-tertiary" title={app.client_id}>
        {app.client_id}
      </code>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-content-tertiary">
        <span>{t('apps.developers.redirectUriCount', { count: app.redirect_uris.length })}</span>
        <span className="truncate" title={app.scopes.join(', ')}>
          {t('apps.developers.scopeCount', { count: app.scopes.length })}
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
  const t = useTranslate();
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
      display_name: required(t('apps.developers.form.nameRequired')),
      redirect_uris: redirectUrisRequired(t('apps.developers.form.redirectUrisRequired')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      // The one rule this screen enforces itself rather than round-tripping to
      // the server for: an empty scope set is caught here for the same reason
      // `narrowScopes` refuses it there — a client with no scopes is unbounded,
      // not restricted, so it is never a state Submit should allow reaching.
      if (scopes.size === 0) {
        setSubmitError(t('apps.developers.form.selectScope'));
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
        // The server names exactly which redirect URI or scope was rejected and
        // why (validation only) — the ADR-06 general validation sentence would
        // lose that detail, so it is shown as-is (Composer.tsx/IpAllowlist.tsx
        // precedent). Any other failure funnels through the catalogue as usual.
        if (error instanceof ApiClientError && error.type === 'validation') {
          // i18n-ignore: server-specific validation detail, see the note above.
          setSubmitError(error.message);
          return;
        }
        setSubmitError(t(errorMessageKey(error)));
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
      title={t('apps.developers.registerModal.title')}
      description={t('apps.developers.registerModal.description')}
      className="w-[30rem]"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        <label htmlFor="partner-app-name" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.form.appName')}
          </span>
          <input
            id="partner-app-name"
            value={form.values.display_name}
            onChange={(event) => form.setValue('display_name', event.target.value)}
            onBlur={() => form.blur('display_name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'partner-app-name-error' : undefined}
            placeholder={t('apps.developers.form.appNamePlaceholder')}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
          />
          <FieldError id="partner-app-name-error" message={nameError} />
        </label>

        <label htmlFor="partner-app-client-type" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.form.clientType')}
          </span>
          <select
            id="partner-app-client-type"
            value={clientType}
            onChange={(event) => setClientType(event.target.value as PartnerAppClientType)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            <option value="public">{t('apps.developers.form.clientTypePublic')}</option>
            <option value="confidential">{t('apps.developers.form.clientTypeConfidential')}</option>
          </select>
        </label>

        <label htmlFor="partner-app-redirect-uris" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.form.redirectUris')}
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
        <p className="-mt-2 text-2xs text-content-tertiary">
          {t('apps.developers.form.oneUriPerLine')}
        </p>

        <fieldset className="flex flex-col gap-1">
          <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.form.scopes')}
          </legend>
          <p className="text-2xs text-content-tertiary">{t('apps.developers.form.scopesHint')}</p>
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
            {t('apps.common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting
              ? t('apps.developers.form.registering')
              : t('apps.developers.form.register')}
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
  const t = useTranslate();
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
      description={t('apps.developers.secret.description')}
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.secret.clientId')}
          </span>
          <code className="truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
            {registration.client_id}
          </code>
        </div>

        {registration.client_secret && (
          <div className="flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
              {t('apps.developers.secret.clientSecret')}
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
                {copied ? t('apps.common.copied') : t('apps.common.copy')}
              </button>
            </div>
            <p role="alert" className="text-2xs text-warning">
              {t('apps.developers.secret.warning')}
            </p>
          </div>
        )}

        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('apps.common.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteAppModal({ app, onClose }: { app: PartnerApp; onClose: () => void }): ReactElement {
  const api = useApiClient();
  const t = useTranslate();
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
      title={t('apps.developers.deleteModal.title', { name: app.display_name })}
      description={t('apps.developers.deleteModal.description')}
    >
      {remove.isError && <ErrorNotice message={t(errorMessageKey(remove.error))} />}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('apps.common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {remove.isPending ? t('apps.common.deleting') : t('apps.developers.deleteModal.confirm')}
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
  const t = useTranslate();

  const rotate = useMutation({
    mutationFn: () =>
      api.post<PartnerAppSecretRotation>(`/partner/apps/${app.client_id}/rotate-secret`),
    onSuccess: (rotation) => onRotated(rotation),
  });

  return (
    <Modal
      onClose={onClose}
      title={t('apps.developers.rotateModal.title', { name: app.display_name })}
      description={t('apps.developers.rotateModal.description')}
    >
      {rotate.isError && <ErrorNotice message={t(errorMessageKey(rotate.error))} />}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('apps.common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => rotate.mutate()}
          disabled={rotate.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {rotate.isPending
            ? t('apps.developers.rotateModal.rotating')
            : t('apps.developers.rotateSecret')}
        </button>
      </div>
    </Modal>
  );
}
