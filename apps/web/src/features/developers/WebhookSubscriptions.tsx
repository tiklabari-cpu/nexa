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
import type { IntegrationAction, IntegrationTrigger } from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { Modal } from '../../components/ui/index.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { FieldError, required, useForm } from '../../lib/form.js';

const WEBHOOKS_KEY = ['developers', 'webhooks'] as const;
const MANIFEST_KEY = ['developers', 'integration-manifest'] as const;

interface Webhook {
  id: string;
  url: string;
  action: string;
  type: 'license' | 'bot';
  enabled: boolean;
  created_at: string;
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
  const manifest = useIntegrationManifest();
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
      title="Webhooks"
      description="Subscribe a URL to be POSTed when something happens here — the same REST Hooks model Zapier and Make use."
    >
      {list.error ? (
        <ErrorNotice message="Could not load your webhooks." />
      ) : (
        <Card>
          {canEdit && (
            <SubscribeForm
              manifestTriggers={manifest.data?.triggers ?? []}
              onSubscribed={setNewSubscription}
            />
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No webhook subscriptions yet"
              description="Subscribe a URL to be notified the moment a chat starts, a message comes in, or a ticket opens."
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
                      label={webhook.enabled ? 'Enabled' : 'Disabled'}
                    />
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(webhook)}
                        aria-label={`Delete webhook for ${webhook.url}`}
                        className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        Delete
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-2xs text-content-tertiary">
                    <span className="rounded-sm bg-inset px-1.5 py-0.5">
                      {triggerLabel(webhook.action)}
                    </span>
                    <span>{webhook.type === 'bot' ? 'Bot-scoped' : 'Workspace-wide'}</span>
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

function SubscribeForm({
  manifestTriggers,
  onSubscribed,
}: {
  manifestTriggers: readonly IntegrationTrigger[];
  onSubscribed: (registration: WebhookRegistration) => void;
}): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const subscribe = useMutation({
    mutationFn: (body: { url: string; action: string }) =>
      api.post<WebhookRegistration>('/webhooks', body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WEBHOOKS_KEY });
    },
  });

  const form = useForm({
    initial: { url: '', action: '' },
    validators: {
      url: required('Enter the URL to receive the webhook.'),
      action: required('Choose an event.'),
    },
    onSubmit: async (values, { setFieldError, setSubmitError, reset }) => {
      try {
        const registration = await subscribe.mutateAsync({
          url: values.url.trim(),
          action: values.action,
        });
        reset();
        onSubscribed(registration);
      } catch (error) {
        // The server's SSRF and shape checks (`assertPublicHttpUrl`) are both
        // reported as a validation error naming the URL — pin it under the
        // field the person was looking at rather than a generic banner.
        if (error instanceof ApiClientError && error.type === 'validation') {
          setFieldError('url', error.message);
          return;
        }
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not subscribe that webhook.',
        );
      }
    },
  });

  const urlError = form.errorFor('url');
  const actionError = form.errorFor('action');

  return (
    <form
      onSubmit={form.handleSubmit}
      noValidate
      className="flex flex-wrap items-end gap-3 border-b border-border p-4"
    >
      <label htmlFor="webhook-url" className="flex min-w-56 flex-1 flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          URL
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
          Event
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
            {manifestTriggers.length === 0 ? 'Loading events…' : 'Select an event…'}
          </option>
          {manifestTriggers.map((trigger) => (
            <option key={trigger.action} value={trigger.action}>
              {trigger.label}
            </option>
          ))}
        </select>
        <FieldError id="webhook-action-error" message={actionError} />
      </label>

      <button
        type="submit"
        disabled={!form.canSubmit}
        className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {form.isSubmitting ? 'Subscribing…' : 'Subscribe'}
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
      title="Webhook subscribed"
      description="Save this signing secret now."
      className="w-[28rem]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            URL
          </span>
          <code className="truncate rounded-md border border-border bg-inset px-2 py-1.5 text-2xs">
            {registration.url}
          </code>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            Signing secret
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
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p role="alert" className="text-2xs text-warning">
            This secret will not be shown again — every delivery is signed with it.
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

function DeleteWebhookModal({
  webhook,
  onClose,
}: {
  webhook: Webhook;
  onClose: () => void;
}): ReactElement {
  const api = useApiClient();
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
      title={`Delete webhook for ${webhook.url}?`}
      description="Deliveries to this URL stop immediately. This cannot be undone."
    >
      {remove.isError && (
        <ErrorNotice
          message={
            remove.error instanceof ApiClientError
              ? remove.error.message
              : 'Could not delete that webhook.'
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
          {remove.isPending ? 'Deleting…' : 'Delete webhook'}
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
  const manifest = useIntegrationManifest();

  if (manifest.error) {
    return <ErrorNotice message="Could not load the integration manifest." />;
  }
  if (manifest.isPending) {
    return <p className="p-4 text-sm text-content-secondary">Loading…</p>;
  }

  const { triggers, actions, subscribe, unsubscribe } = manifest.data;

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="Triggers"
        description="Workspace events a Zapier/Make trigger can subscribe to — one per webhook action."
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
        title="Actions"
        description="Existing write endpoints a Zapier/Make action step may call — no new endpoint or scope."
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
                  Requires: {action.required_scopes.join(' or ')}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section
        title="Subscribe / unsubscribe"
        description="Where a REST Hooks integration registers and removes a subscription."
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
