/**
 * Settings — trusted domains, saved replies and routing.
 *
 * Trusted domains leads because it is the one setting that gates the product
 * working at all: until a customer's domain is here, the widget on their site
 * cannot mint a token, and the failure looks like a broken widget rather than
 * missing configuration.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';

interface TrustedDomain {
  id: string;
  domain: string;
  include_subdomains: boolean;
  created_at: string;
}

interface CannedResponse {
  id: string;
  shortcut: string;
  text: string;
  scope: 'chat' | 'ticket';
}

interface RoutingRule {
  id: string;
  name: string | null;
  kind: string;
  conditions: Record<string, unknown>;
  target_group_id: number | null;
  target_group_name: string | null;
  priority: number;
  is_fallback: boolean;
  enabled: boolean;
}

export function SettingsPage(): ReactElement {
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canManageAccess = scopes.includes('access_rules:rw');
  const canManageReplies = scopes.includes('canned_responses--all:rw');

  return (
    <Page title="Settings" description="Widget installation, saved replies and routing.">
      <TrustedDomains canEdit={canManageAccess} />
      <CannedResponses canEdit={canManageReplies} />
      <RoutingRules canEdit={canManageAccess} />
    </Page>
  );
}

// --- Trusted domains ---------------------------------------------------------

function TrustedDomains({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState('');
  const [includeSubdomains, setIncludeSubdomains] = useState(false);

  const list = useQuery({
    queryKey: ['settings', 'trusted-domains'],
    queryFn: () => api.get<{ items: TrustedDomain[] }>('/settings/trusted-domains'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'trusted-domains'] });

  const add = useMutation({
    mutationFn: (body: { domain: string; include_subdomains: boolean }) =>
      api.post<TrustedDomain>('/settings/trusted-domains', body),
    onSuccess: () => {
      setDomain('');
      setIncludeSubdomains(false);
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/trusted-domains/${id}`),
    onSuccess: invalidate,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!domain.trim()) return;
    add.mutate({ domain: domain.trim(), include_subdomains: includeSubdomains });
  }

  return (
    <Section
      title="Trusted domains"
      description="The widget only works on these sites. Everywhere else it is refused a token."
    >
      {list.error ? (
        <ErrorNotice message="Could not load trusted domains." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={submit}
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-domain" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Domain
                </span>
                <input
                  id="new-domain"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="shop.example"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>

              <label className="flex items-center gap-2 pb-1.5 text-sm text-content-secondary">
                <input
                  type="checkbox"
                  checked={includeSubdomains}
                  onChange={(event) => setIncludeSubdomains(event.target.checked)}
                />
                Include subdomains
              </label>

              <button
                type="submit"
                disabled={!domain.trim() || add.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {add.isPending ? 'Adding…' : 'Add domain'}
              </button>

              {add.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {add.error instanceof ApiClientError
                    ? add.error.message
                    : 'Could not add that domain.'}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No domains yet"
              description="Add the site you want the widget on. Until then it cannot start conversations anywhere."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">
                    {item.include_subdomains && <span className="text-content-tertiary">*.</span>}
                    {item.domain}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

// --- Canned responses --------------------------------------------------------

function CannedResponses({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [shortcut, setShortcut] = useState('');
  const [text, setText] = useState('');

  const list = useQuery({
    queryKey: ['settings', 'canned-responses'],
    queryFn: () => api.get<{ items: CannedResponse[] }>('/settings/canned-responses?scope=chat'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'canned-responses'] });
    // The composer reads the same replies; leaving its cache alone would mean a
    // new shortcut does not appear until the agent reloads.
    void queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
  };

  const create = useMutation({
    mutationFn: (body: { shortcut: string; text: string }) =>
      api.post<CannedResponse>('/settings/canned-responses', body),
    onSuccess: () => {
      setShortcut('');
      setText('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/canned-responses/${id}`),
    onSuccess: invalidate,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!shortcut.trim() || !text.trim()) return;
    create.mutate({ shortcut: shortcut.trim(), text: text.trim() });
  }

  return (
    <Section title="Saved replies" description="Agents insert these by typing # in the composer.">
      {list.error ? (
        <ErrorNotice message="Could not load saved replies." />
      ) : (
        <Card>
          {canEdit && (
            <form onSubmit={submit} className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-shortcut" className="flex w-48 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Shortcut
                  </span>
                  <div className="flex items-center gap-1">
                    <span aria-hidden="true" className="text-content-tertiary">
                      #
                    </span>
                    <input
                      id="new-shortcut"
                      value={shortcut}
                      onChange={(event) => setShortcut(event.target.value)}
                      placeholder="shipping"
                      className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  </div>
                </label>

                <label htmlFor="new-reply" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Reply
                  </span>
                  <input
                    id="new-reply"
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    placeholder="Standard delivery takes 3-5 working days."
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>

                <button
                  type="submit"
                  disabled={!shortcut.trim() || !text.trim() || create.isPending}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {create.isPending ? 'Saving…' : 'Save reply'}
                </button>
              </div>

              {create.isError && (
                <p role="alert" className="text-2xs text-danger">
                  {create.error instanceof ApiClientError
                    ? create.error.message
                    : 'Could not save that reply.'}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No saved replies"
              description="Save the answers your team types most often."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                  <code className="mt-0.5 shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-2xs">
                    #{item.shortcut}
                  </code>
                  <span className="flex-1 text-sm text-content-secondary">{item.text}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      aria-label={`Delete #${item.shortcut}`}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Delete
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

// --- Routing rules -----------------------------------------------------------

function RoutingRules({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'routing-rules'],
    queryFn: () => api.get<{ items: RoutingRule[] }>('/settings/routing-rules'),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<RoutingRule>(`/settings/routing-rules/${id}`, { enabled }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['settings', 'routing-rules'] }),
  });

  return (
    <Section
      title="Routing"
      description="Checked in order. The first rule whose conditions all match decides the team."
    >
      {list.error ? (
        <ErrorNotice message="Could not load routing rules." />
      ) : (
        <Card>
          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No routing rules"
              description="Without a fallback rule, conversations have nowhere to go."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {rule.name ?? (rule.is_fallback ? 'Everything else' : 'Rule')}
                      {rule.is_fallback && (
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-normal text-content-secondary">
                          fallback
                        </span>
                      )}
                    </p>
                    <p className="truncate text-2xs text-content-tertiary">
                      {describeConditions(rule.conditions)} → {rule.target_group_name ?? 'no team'}
                    </p>
                  </div>

                  <StatusDot
                    tone={rule.enabled ? 'success' : 'neutral'}
                    label={rule.enabled ? 'On' : 'Off'}
                  />

                  {canEdit && (
                    <button
                      type="button"
                      // The fallback cannot be turned off — conversations that
                      // match nothing would have nowhere to go, and the
                      // configuration would still look healthy.
                      disabled={rule.is_fallback || toggle.isPending}
                      title={rule.is_fallback ? 'The fallback rule cannot be disabled' : undefined}
                      onClick={() => toggle.mutate({ id: rule.id, enabled: !rule.enabled })}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

/** Renders the condition JSON as something an admin can read at a glance. */
function describeConditions(conditions: Record<string, unknown>): string {
  const entries = Object.entries(conditions ?? {});
  if (entries.length === 0) return 'Anything';
  return entries.map(([key, value]) => `${key.replace(/_/g, ' ')} ${String(value)}`).join(' and ');
}
