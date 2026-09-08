/**
 * Webhook subscriptions + integration manifest — FR-MOD-09.4 (Zapier/Make REST
 * Hooks surface) and FR-MOD-08.8.4's screen (registration existed server-side
 * since tm 34; nothing consumed it in `apps/web` until this file).
 *
 * `WebhookSubscriptions` is the subscribe/list/unsubscribe half: list reads
 * `GET /webhooks` (never a secret — the server's `SAFE_SELECT` never selects
 * it), Subscribe posts to the same endpoint Zapier's REST Hooks flow would use,
 * and the signing secret the response carries is shown exactly once — the same
 * one-render discipline as `DeveloperPortal.tsx`'s `SecretOncePanel`, kept as a
 * separate component here rather than imported to avoid a cycle (this module is
 * imported BY `DeveloperPortal.tsx`). The event dropdown's options are read from
 * `GET /integrations/manifest`'s `triggers`, never a hard-coded copy of
 * `WEBHOOK_ACTIONS` — a new action added server-side needs no change here.
 *
 * `IntegrationManifestReference` is the read-only third tab: the same manifest,
 * rendered as a reference for whoever is wiring up a Zapier/Make app definition
 * (which trigger fires on what, which action steps exist, where to subscribe).
 * It requests nothing and confirms nothing — every field it shows is already a
 * static description on the server (`routes/webhooks.ts`).
 *
 * Every server rejection (a private/loopback URL, an unknown action) is shown
 * exactly as the server phrased it, under the field it complains about — this
 * screen does not second-guess the SSRF or scope decision, both of which live
 * in `apps/api` (`lib/ssrf.ts`, `routes/webhooks.ts`).
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppListItem,
  AppListResponse,
  IntegrationAction,
  IntegrationTrigger,
} from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

const WEBHOOKS_KEY = ['developers', 'webhooks'] as const;
const MANIFEST_KEY = ['developers', 'integration-manifest'] as const;
const AUTOMATION_APPS_KEY = ['developers', 'automation-apps'] as const;

/**
 * One page big enough to hold the whole `productivity` section of the catalogue.
 *
 * Exported so the test can compare it against `APP_CATALOG` — see the
 * `paging-exempt` note on the request itself for why a cap is right here and a
 * cursor is not.
 */
export const AUTOMATION_APPS_LIMIT = 100;

interface Webhook {
  id: string;
  url: string;
  action: string;
  type: 'license' | 'bot';
  enabled: boolean;
  created_at: string;
  /** The automation card this subscription belongs to (FR-MOD-09.4), or null. */
  app_id: string | null;
}

/** The register response — the signing secret, present once and only here. */
interface WebhookRegistration extends Webhook {
  secret: string;
}

interface IntegrationManifest {
  triggers: readonly IntegrationTrigger[];
  actions: readonly IntegrationAction[];
  subscribe: { method: string; path: string };
  unsubscribe: { method: string; path: string };
}

/**
 * The automation cards this workspace has connected (FR-MOD-09.4).
 *
 * Read rather than hard-coded, and *connected* rather than merely catalogued:
 * the server refuses a subscription for a card that is not connected, so
 * offering one here would only produce a 400 the person cannot act on. One
 * request, narrowed to the catalogue's `productivity` section — the two
 * automation platforms both live there — and filtered to the cards that came
 * back with live automation figures, which is exactly the set the server will
 * accept.
 */
function useConnectedAutomationApps() {
  const api = useApiClient();
  return useQuery({
    queryKey: AUTOMATION_APPS_KEY,
    // paging-exempt: the bound is over `APP_CATALOG`, a compile-time constant in
    // `@nexa/types`, not over tenant data — the failure NFR-P5 exists to prevent
    // (a workspace whose rows outgrow one page) cannot happen to a list that a
    // deployment cannot lengthen. `productivity` holds 13 cards today, and the
    // one way the cap could be exceeded — someone adding the 101st — is pinned
    // by `WebhookSubscriptions.test.tsx` rather than left to be noticed.
    queryFn: () =>
      api.get<AppListResponse>(
        `/settings/apps?category=productivity&limit=${AUTOMATION_APPS_LIMIT}`,
      ),
    select: (data) => data.items.filter((app) => app.installation?.automation),
    staleTime: 30_000,
  });
}

function useIntegrationManifest() {
  const api = useApiClient();
  return useQuery({
    queryKey: MANIFEST_KEY,
    queryFn: () => api.get<IntegrationManifest>('/integrations/manifest'),
    // Static on the server (no tenant data, computed once) — safe to treat as
    // effectively constant for the lifetime of this screen.
    staleTime: 60_000,
  });
}

export function WebhookSubscriptions({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const t = useTranslate();
  const manifest = useIntegrationManifest();
  const automationApps = useConnectedAutomationApps();
  const [newSubscription, setNewSubscription] = useState<WebhookRegistration | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Webhook | null>(null);

  const list = useQuery({
    queryKey: WEBHOOKS_KEY,
    queryFn: () => api.get<{ items: Webhook[] }>('/webhooks'),
  });

  const triggerLabel = (action: string): string =>
    manifest.data?.triggers.find((trigger) => trigger.action === action)?.label ?? action;

  return (
    <Section
      title={t('apps.developers.webhooks.title')}
      description={t('apps.developers.webhooks.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('apps.developers.webhooks.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <SubscribeForm
              manifestTriggers={manifest.data?.triggers ?? []}
              automationApps={automationApps.data ?? []}
              onSubscribed={setNewSubscription}
            />
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('apps.common.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('apps.developers.webhooks.emptyTitle')}
              description={t('apps.developers.webhooks.emptyDescription')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((webhook) => (
                <li
                  key={webhook.id}
                  data-testid={`webhook-${webhook.id}`}
                  className="flex flex-col gap-1.5 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1 truncate font-mono text-sm" title={webhook.url}>
                      {webhook.url}
                    </span>
                    <StatusDot
                      tone={webhook.enabled ? 'success' : 'neutral'}
                      label={
                        webhook.enabled
                          ? t('apps.developers.webhooks.enabled')
                          : t('apps.developers.webhooks.disabled')
                      }
                    />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(webhook)}
                        aria-label={t('apps.developers.webhooks.deleteFor', { url: webhook.url })}
                        className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('apps.developers.delete')}
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-content-tertiary">
                    <span className="rounded-sm bg-inset px-1.5 py-0.5">
                      {triggerLabel(webhook.action)}
                    </span>
                    <span>
                      {webhook.type === 'bot'
                        ? t('apps.developers.webhooks.botScoped')
                        : t('apps.developers.webhooks.workspaceWide')}
                    </span>
                    {/* Which automation card owns this subscription (FR-MOD-09.4).
                        Named from the connected-apps list so the row says
                        "Zapier" rather than the catalogue id, and falls back to
                        the id when that list has not arrived yet. */}
                    {webhook.app_id && (
                      <span className="rounded-sm bg-inset px-1.5 py-0.5">
                        {t('apps.developers.webhooks.viaApp', {
                          app: appName(automationApps.data, webhook.app_id),
                        })}
                      </span>
                    )}
                    <span>{formatDateTime(webhook.created_at)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Same one-render discipline as a partner app's secret: state only, no
          other copy, discarded the instant this closes. */}
      {newSubscription && (
        <WebhookSecretPanel
          registration={newSubscription}
          onClose={() => setNewSubscription(null)}
        />
      )}

      {deleteTarget && (
        <DeleteWebhookModal webhook={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </Section>
  );
}

/** A connected card's display name, or its catalogue id when the list is not in yet. */
function appName(apps: readonly AppListItem[] | undefined, appId: string): string {
  return apps?.find((app) => app.id === appId)?.name ?? appId;
}

function SubscribeForm({
  manifestTriggers,
  automationApps,
  onSubscribed,
}: {
  manifestTriggers: readonly IntegrationTrigger[];
  /** The connected automation cards a subscription may be attached to (FR-MOD-09.4). */
  automationApps: readonly AppListItem[];
  onSubscribed: (registration: WebhookRegistration) => void;
}): ReactElement {
  const api = useApiClient();
  const t = useTranslate();
  const queryClient = useQueryClient();

  const subscribe = useMutation({
    mutationFn: (body: { url: string; action: string; app_id?: string }) =>
      api.post<WebhookRegistration>('/webhooks', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY });
      // The card's trigger count just changed, and it is read through a
      // different query than this list.
      await queryClient.invalidateQueries({ queryKey: AUTOMATION_APPS_KEY });
    },
  });

  const form = useForm({
    // `app_id` is deliberately un-validated: a subscription with no automation
    // card is the ordinary case — every webhook registered before 09.4 is one.
    initial: { url: '', action: '', app_id: '' },
    validators: {
      url: required(t('apps.developers.webhooks.form.urlRequired')),
      action: required(t('apps.developers.webhooks.form.eventRequired')),
    },
    onSubmit: async (values, { setFieldError, setSubmitError, reset }) => {
      try {
        const registration = await subscribe.mutateAsync({
          url: values.url.trim(),
          action: values.action,
          ...(values.app_id ? { app_id: values.app_id } : {}),
        });
        reset();
        onSubscribed(registration);
      } catch (error) {
        // The server's SSRF and shape checks (`assertPublicHttpUrl`) are both
        // reported as a validation error naming the URL — pin it under the
        // field the person was looking at rather than a generic banner. The
        // two `app_id` refusals (not an automation card / not connected) are
        // the exception, and the server prefixes them, so the client can tell
        // them apart without re-deriving the rule it is not the authority on.
        if (error instanceof ApiClientError && error.type === 'validation') {
          // i18n-ignore: server names the exact rejection, see the note above.
          setFieldError(error.message.startsWith('app_id:') ? 'app_id' : 'url', error.message);
          return;
        }
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const urlError = form.errorFor('url');
  const actionError = form.errorFor('action');
  const appError = form.errorFor('app_id');

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-wrap items-end gap-3 border-b border-border p-4"
    >
      <label htmlFor="webhook-url" className="flex min-w-56 flex-1 flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('apps.developers.webhooks.form.urlLabel')}
        </span>
        <input
          id="webhook-url"
          value={form.values.url}
          onChange={(event) => form.setValue('url', event.target.value)}
          onBlur={() => form.blur('url')}
          aria-invalid={urlError ? true : undefined}
          aria-describedby={urlError ? 'webhook-url-error' : undefined}
          placeholder="https://hooks.example.com/receiver"
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
        />
        <FieldError id="webhook-url-error" message={urlError} />
      </label>

      <label htmlFor="webhook-action" className="flex w-52 flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('apps.developers.webhooks.form.eventLabel')}
        </span>
        <select
          id="webhook-action"
          value={form.values.action}
          onChange={(event) => form.setValue('action', event.target.value)}
          onBlur={() => form.blur('action')}
          disabled={manifestTriggers.length === 0}
          aria-invalid={actionError ? true : undefined}
          aria-describedby={actionError ? 'webhook-action-error' : undefined}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
        >
          <option value="" disabled>
            {manifestTriggers.length === 0
              ? t('apps.developers.webhooks.form.loadingEvents')
              : t('apps.developers.webhooks.form.selectEvent')}
          </option>
          {manifestTriggers.map((trigger) => (
            <option key={trigger.action} value={trigger.action}>
              {trigger.label}
            </option>
          ))}
        </select>
        <FieldError id="webhook-action-error" message={actionError} />
      </label>

      {/* Only rendered when there is something to choose: a workspace with no
          automation card connected has no reason to be shown an empty select,
          and the field is optional in every case (FR-MOD-09.4). */}
      {automationApps.length > 0 && (
        <label htmlFor="webhook-app" className="flex w-52 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.webhooks.form.appLabel')}
          </span>
          <select
            id="webhook-app"
            value={form.values.app_id}
            onChange={(event) => form.setValue('app_id', event.target.value)}
            onBlur={() => form.blur('app_id')}
            aria-invalid={appError ? true : undefined}
            aria-describedby={appError ? 'webhook-app-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            <option value="">{t('apps.developers.webhooks.form.appNone')}</option>
            {automationApps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.name}
              </option>
            ))}
          </select>
          <FieldError id="webhook-app-error" message={appError} />
        </label>
      )}

      <button
        type="submit"
        disabled={!form.canSubmit}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {form.isSubmitting
          ? t('apps.developers.webhooks.form.subscribing')
          : t('apps.developers.webhooks.form.subscribe')}
      </button>

      {form.submitError && (
        <p role="alert" className="w-full text-2xs text-danger">
          {form.submitError}
        </p>
      )}
    </form>
  );
}

/**
 * The webhook's signing secret, shown exactly once (register response only —
 * `GET /webhooks` never carries it). Closing discards it from state, not just
 * the dialog; nothing here persists a second copy.
 */
function WebhookSecretPanel({
  registration,
  onClose,
}: {
  registration: WebhookRegistration;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);

  function copy(): void {
    void navigator.clipboard?.writeText(registration.secret).then(
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
      title={t('apps.developers.webhooks.secret.title')}
      description={t('apps.developers.webhooks.secret.description')}
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.webhooks.secret.url')}
          </span>
          <code className="truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
            {registration.url}
          </code>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('apps.developers.webhooks.secret.signingSecret')}
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
              {registration.secret}
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
            {t('apps.developers.webhooks.secret.warning')}
          </p>
        </div>

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

function DeleteWebhookModal({
  webhook,
  onClose,
}: {
  webhook: Webhook;
  onClose: () => void;
}): ReactElement {
  const api = useApiClient();
  const t = useTranslate();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/webhooks/${webhook.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY });
      onClose();
    },
  });

  return (
    <Modal
      onClose={onClose}
      title={t('apps.developers.webhooks.deleteModal.title', { url: webhook.url })}
      description={t('apps.developers.webhooks.deleteModal.description')}
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
          {remove.isPending
            ? t('apps.common.deleting')
            : t('apps.developers.webhooks.deleteModal.confirm')}
        </button>
      </div>
    </Modal>
  );
}

/**
 * The read-only third tab: the same `GET /integrations/manifest` document a
 * Zapier/Make app definition is built from, laid out for a human — which
 * events are subscribable (`triggers`), which existing write endpoints an
 * action step may call (`actions`), and the subscribe/unsubscribe pair every
 * REST Hooks integration needs. Nothing here is tenant data or a request this
 * screen makes on the caller's behalf.
 */
export function IntegrationManifestReference(): ReactElement {
  const t = useTranslate();
  const manifest = useIntegrationManifest();

  if (manifest.error) {
    return <ErrorNotice message={t('apps.developers.manifest.loadError')} />;
  }
  if (manifest.isPending) {
    return <p className="p-4 text-sm text-content-secondary">{t('apps.common.loading')}</p>;
  }

  const { triggers, actions, subscribe, unsubscribe } = manifest.data;

  return (
    <div className="flex flex-col gap-6">
      <Section
        title={t('apps.developers.manifest.triggersTitle')}
        description={t('apps.developers.manifest.triggersDescription')}
      >
        <Card>
          <ul className="divide-y divide-border">
            {triggers.map((trigger) => (
              <li key={trigger.action} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="text-2xs text-content-tertiary">{trigger.action}</code>
                  <span className="text-sm font-medium">{trigger.label}</span>
                </div>
                <p className="text-2xs text-content-secondary">{trigger.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        title={t('apps.developers.manifest.actionsTitle')}
        description={t('apps.developers.manifest.actionsDescription')}
      >
        <Card>
          <ul className="divide-y divide-border">
            {actions.map((action) => (
              <li key={action.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-medium">
                    {action.method}
                  </span>
                  <code className="text-2xs text-content-tertiary">{action.path}</code>
                  <span className="text-sm font-medium">{action.label}</span>
                </div>
                <p className="text-2xs text-content-tertiary">
                  {t('apps.developers.manifest.requires', {
                    scopes: action.required_scopes.join(t('apps.developers.manifest.orJoiner')),
                  })}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        title={t('apps.developers.manifest.subscribeTitle')}
        description={t('apps.developers.manifest.subscribeDescription')}
      >
        <Card>
          <ul className="divide-y divide-border">
            <li className="flex items-center gap-2 px-4 py-3 text-2xs">
              <span className="rounded-sm bg-inset px-1.5 py-0.5 font-medium">
                {subscribe.method}
              </span>
              <code>{subscribe.path}</code>
            </li>
            <li className="flex items-center gap-2 px-4 py-3 text-2xs">
              <span className="rounded-sm bg-inset px-1.5 py-0.5 font-medium">
                {unsubscribe.method}
              </span>
              <code>{unsubscribe.path}</code>
            </li>
          </ul>
        </Card>
      </Section>
    </div>
  );
}
