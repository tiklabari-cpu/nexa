/**
 * Settings — trusted domains, saved replies and routing.
 *
 * Trusted domains leads because it is the one setting that gates the product
 * working at all: until a customer's domain is here, the widget on their site
 * cannot mint a token, and the failure looks like a broken widget rather than
 * missing configuration.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { ChannelsGrid } from './Channels.js';
import {
  DEFAULT_PREFS,
  loadPrefs,
  savePrefs,
  type NotificationPrefs,
  type Permission,
} from '../notifications/notifications.js';
import {
  currentPermission,
  requestNotificationPermission,
} from '../notifications/useNotifications.js';

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

interface Tag {
  id: string;
  name: string;
  group_ids: number[];
  author_id: string | null;
  usage_count: number;
  created_at: string;
}

interface SecuritySettings {
  file_sharing_enabled: boolean;
  allowed_file_types: string[];
  max_file_size_bytes: number;
  spam_filter_enabled: boolean;
  require_two_factor: boolean;
  updated_at: string | null;
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
  const canManageTags = scopes.includes('tags--all:rw');

  return (
    <Page title="Settings" description="Widget installation, saved replies and routing.">
      <ChannelsGrid />
      <NotificationSettings />
      <WebsiteWidgets canEdit={canManageAccess} />
      <TrustedDomains canEdit={canManageAccess} />
      <FileSharing canEdit={canManageAccess} />
      <CannedResponses canEdit={canManageReplies} />
      <Tags canEdit={canManageTags} />
      <RoutingRules canEdit={canManageAccess} />
    </Page>
  );
}

// --- Notifications -----------------------------------------------------------

/**
 * Per-agent alert preferences (FR-MOD-13.8).
 *
 * These live in the browser, not the account: they are about this device — its
 * speakers, its OS permission — so a preference set on a laptop should not
 * follow the agent to a shared kiosk. The inbox reads the same store on every
 * incoming message, so a change here takes effect on the next one without a
 * reload.
 */
function NotificationSettings(): ReactElement {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [permission, setPermission] = useState<Permission>('default');

  // Read once on mount — `loadPrefs` touches `localStorage`, which is not a
  // render-time value.
  useEffect(() => {
    setPrefs(loadPrefs());
    setPermission(currentPermission());
  }, []);

  function update(patch: Partial<NotificationPrefs>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      savePrefs(next);
      return next;
    });
  }

  async function enableDesktop(): Promise<void> {
    const result = await requestNotificationPermission();
    setPermission(result);
    // Turning the desktop toggle on is pointless if the browser refuses; keep
    // the stored preference honest about what will actually happen.
    if (result === 'granted') update({ desktop: true });
  }

  const desktopBlocked = permission === 'denied' || permission === 'unsupported';

  return (
    <Section
      title="Notifications"
      description="How you are alerted to new messages on this device. These settings are per-browser."
    >
      <Card>
        <div className="divide-y divide-border">
          <label className="flex items-center gap-3 p-4">
            <input
              type="checkbox"
              checked={prefs.enabled}
              onChange={(event) => update({ enabled: event.target.checked })}
            />
            <span className="flex-1 text-sm">
              Enable notifications
              <span className="block text-2xs text-content-tertiary">
                Turning this off silences sound, desktop and tab alerts alike.
              </span>
            </span>
            <StatusDot
              tone={prefs.enabled ? 'success' : 'neutral'}
              label={prefs.enabled ? 'On' : 'Off'}
            />
          </label>

          <label className="flex items-center gap-3 p-4">
            <input
              type="checkbox"
              checked={prefs.sound}
              disabled={!prefs.enabled}
              onChange={(event) => update({ sound: event.target.checked })}
            />
            <span className="flex-1 text-sm">
              Play a sound
              <span className="block text-2xs text-content-tertiary">
                A short chime when a visitor writes in.
              </span>
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3 p-4">
            <label className="flex flex-1 items-center gap-3">
              <input
                type="checkbox"
                checked={prefs.desktop && permission === 'granted'}
                disabled={!prefs.enabled || desktopBlocked}
                onChange={(event) => update({ desktop: event.target.checked })}
              />
              <span className="text-sm">
                Desktop notifications
                <span className="block text-2xs text-content-tertiary">
                  {permission === 'granted'
                    ? 'Shown even when this tab is in the background.'
                    : permission === 'denied'
                      ? 'Blocked in your browser — allow notifications for this site to use them.'
                      : permission === 'unsupported'
                        ? 'This browser does not support desktop notifications.'
                        : 'Ask your browser for permission to show these.'}
                </span>
              </span>
            </label>

            {prefs.enabled && permission !== 'granted' && permission !== 'unsupported' && (
              <button
                type="button"
                onClick={() => void enableDesktop()}
                disabled={permission === 'denied'}
                className="rounded-md border border-border px-3 py-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                Enable desktop notifications
              </button>
            )}
          </div>
        </div>
      </Card>
    </Section>
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
      description="The allowlist the widget checks. Adding a website above fills this in for you; edit it here only for finer control, such as covering subdomains."
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

// --- File sharing ------------------------------------------------------------

/**
 * The rules every upload is checked against, on both sides of a conversation.
 *
 * They were in the schema from the start but had no screen, so every workspace
 * ran on the shipped defaults — three file types and 10 MiB — whether or not
 * those suited it, and nobody could see what the limits were.
 */
function FileSharing({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [types, setTypes] = useState<string | null>(null);
  const [sizeMb, setSizeMb] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  const save = useMutation({
    mutationFn: (body: Partial<SecuritySettings>) =>
      api.patch<SecuritySettings>('/settings/security', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'security'], data);
      setTypes(null);
      setSizeMb(null);
    },
  });

  if (settings.error) return <ErrorNotice message="Could not load file sharing rules." />;

  const current = settings.data;
  // `?? current` throughout: the inputs are uncontrolled drafts until touched,
  // so an unsaved edit survives a background refetch.
  const typesDraft = types ?? (current ? current.allowed_file_types.join(', ') : '');
  const sizeDraft = sizeMb ?? (current ? String(Math.round(current.max_file_size_bytes / 1048576)) : '');

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!current) return;

    const parsedTypes = typesDraft
      .split(',')
      .map((type) => type.trim().toLowerCase())
      .filter(Boolean);
    const megabytes = Number(sizeDraft);
    if (!Number.isFinite(megabytes) || megabytes < 1) return;

    save.mutate({
      allowed_file_types: parsedTypes,
      max_file_size_bytes: Math.round(megabytes * 1048576),
    });
  }

  return (
    <Section
      title="File sharing"
      description="Applies to attachments from agents and customers alike. Anything outside these rules is refused."
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">Loading…</p>
        ) : (
          <div className="divide-y divide-border">
            <label className="flex items-center gap-3 p-4">
              <input
                type="checkbox"
                checked={current!.file_sharing_enabled}
                disabled={!canEdit || save.isPending}
                onChange={(event) => save.mutate({ file_sharing_enabled: event.target.checked })}
              />
              <span className="flex-1 text-sm">
                Allow file sharing
                <span className="block text-2xs text-content-tertiary">
                  Turning this off refuses every attachment, whoever sends it.
                </span>
              </span>
              <StatusDot
                tone={current!.file_sharing_enabled ? 'success' : 'neutral'}
                label={current!.file_sharing_enabled ? 'On' : 'Off'}
              />
            </label>

            <form onSubmit={submit} className="flex flex-wrap items-end gap-3 p-4">
              <label htmlFor="allowed-types" className="flex min-w-64 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Allowed types
                </span>
                <input
                  id="allowed-types"
                  value={typesDraft}
                  disabled={!canEdit}
                  onChange={(event) => setTypes(event.target.value)}
                  placeholder="image/png, application/pdf"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
                <span className="text-2xs text-content-tertiary">
                  MIME types, comma separated — the form a browser labels a file with.
                </span>
              </label>

              <label htmlFor="max-size" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Max size (MB)
                </span>
                <input
                  id="max-size"
                  type="number"
                  min={1}
                  max={100}
                  value={sizeDraft}
                  disabled={!canEdit}
                  onChange={(event) => setSizeMb(event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                />
              </label>

              {canEdit && (
                <button
                  type="submit"
                  disabled={save.isPending}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
              )}

              {save.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {save.error instanceof ApiClientError
                    ? save.error.message
                    : 'Could not save those rules.'}
                </p>
              )}
            </form>
          </div>
        )}
      </Card>
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

// --- Tag library -------------------------------------------------------------

/**
 * The workspace's curated tags (FR-MOD-08.7.1).
 *
 * Chat-level tagging already worked — an agent could type any word — but nothing
 * agreed the vocabulary, so a team ended up with `vip`, `VIP` and `v.i.p.` for
 * one idea. This library is that agreement: the inbox reads the same list to
 * suggest tags, and `usage_count` shows which labels are actually earning their
 * place.
 */
function Tags({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const list = useQuery({
    queryKey: ['settings', 'tags'],
    queryFn: () => api.get<{ items: Tag[] }>('/settings/tags'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'tags'] });
    // The inbox suggests tags from this same list; leaving its cache alone would
    // keep a new tag hidden from the composer until the agent reloads.
    void queryClient.invalidateQueries({ queryKey: ['tag-library'] });
  };

  const create = useMutation({
    mutationFn: (body: { name: string }) => api.post<Tag>('/settings/tags', body),
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/tags/${id}`),
    onSuccess: invalidate,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate({ name: name.trim() });
  }

  return (
    <Section
      title="Tags"
      description="Labels agents apply to conversations. The inbox suggests these as they type."
    >
      {list.error ? (
        <ErrorNotice message="Could not load tags." />
      ) : (
        <Card>
          {canEdit && (
            <form onSubmit={submit} className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-tag-name" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Tag
                  </span>
                  <input
                    id="new-tag-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="vip"
                    maxLength={64}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                </label>

                <button
                  type="submit"
                  disabled={!name.trim() || create.isPending}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {create.isPending ? 'Adding…' : 'Add tag'}
                </button>
              </div>

              {create.isError && (
                <p role="alert" className="text-2xs text-danger">
                  {create.error instanceof ApiClientError
                    ? create.error.message
                    : 'Could not add that tag.'}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No tags yet"
              description="Agree the words your team uses to label conversations."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((tag) => (
                <li key={tag.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="inline-flex items-center rounded-sm bg-inset px-2 py-0.5 font-mono text-2xs">
                    {tag.name}
                  </span>
                  <span className="flex-1 text-2xs text-content-tertiary">
                    {tag.group_ids.length === 0
                      ? 'All teams'
                      : `${tag.group_ids.length} team${tag.group_ids.length === 1 ? '' : 's'}`}
                    {' · '}
                    {tag.usage_count} in use
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(tag.id)}
                      aria-label={`Delete tag ${tag.name}`}
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
