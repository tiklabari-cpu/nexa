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
import { Link } from 'react-router-dom';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { compose, FieldError, required, useForm, type Validator } from '../../lib/form.js';
import { TEMPLATE_VARIABLES, findTemplateProblems, type TemplateField } from '@nexa/types';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  EXPERTISE_NAME_MAX_LENGTH,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@nexa/types';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';
import { Brands } from './Brands.js';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { WidgetCustomization } from './WidgetCustomization.js';
import { ChannelsGrid } from './Channels.js';
import { IpAllowlist } from './IpAllowlist.js';
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
  banned_customer_ips: string[];
  file_sharing_enabled: boolean;
  allowed_file_types: string[];
  max_file_size_bytes: number;
  spam_filter_enabled: boolean;
  require_two_factor: boolean;
  ip_allowlist_enforced: boolean;
  session_idle_timeout_seconds: number | null;
  max_concurrent_sessions: number | null;
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

/**
 * An area of expertise (FR-MOD-08.6.3). Called "expertise" at the API layer
 * because "skill" already names the Playbook automation concept (ADR-14); this
 * product surface still labels it Skills.
 */
interface Expertise {
  id: number;
  name: string;
  slug: string;
}

interface TicketRule {
  id: string;
  name: string;
  conditions: { subject_contains?: string; source?: 'chat' | 'email' };
  actions: { assign_agent_id?: string; assign_group_id?: number; priority?: number; add_tag?: string };
  enabled: boolean;
  position: number;
}

interface TicketEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function SettingsPage(): ReactElement {
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canManageAccess = scopes.includes('access_rules:rw');
  const canManageReplies = scopes.includes('canned_responses--all:rw');
  const canManageTags = scopes.includes('tags--all:rw');
  const canManageTicketRules = scopes.includes('tickets--all:rw');
  const canManageBrands = scopes.includes('brands--all:rw');

  return (
    <Page title="Settings" description="Widget installation, saved replies and routing.">
      <ChannelsGrid />
      <Integrations />
      <NotificationSettings />
      <Brands canEdit={canManageBrands} />
      <WebsiteWidgets canEdit={canManageAccess} />
      <WidgetCustomization canEdit={canManageAccess} />
      <TrustedDomains canEdit={canManageAccess} />
      <BannedCustomerIps canEdit={canManageAccess} />
      <IpAllowlist canEdit={canManageAccess} />
      <AuditLog />
      <FileSharing canEdit={canManageAccess} />
      <CannedResponses canEdit={canManageReplies} />
      <Tags canEdit={canManageTags} />
      <Skills canEdit={canManageAccess} />
      <RoutingRules canEdit={canManageAccess} />
      <TicketRules canEdit={canManageTicketRules} />
      <TicketEmailTemplates canEdit={canManageTicketRules} />
      <CustomFieldsSettings canEdit={canManageAccess} />
      <PreChatFormSettings canEdit={canManageAccess} />
    </Page>
  );
}

// --- Integrations ------------------------------------------------------------

/**
 * The way into the apps marketplace (FR-MOD-08.8.1): a third-party integrations
 * directory whose detail lives in MOD-09. Settings is where an admin wires the
 * workspace up to the outside world — Channels sits right above — so this is
 * where the door belongs; the marketplace itself (09.1) is the room behind it,
 * and the Apps route is not on the module rail, so without this entry it can
 * only be reached by typing the URL.
 */
export function Integrations(): ReactElement {
  return (
    <Section
      title="Integrations"
      description="Connect third-party apps — CRM, payments, e-commerce and more. A connected app shows its data right inside a conversation."
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-content-secondary">
            Browse the marketplace to connect the tools your team already uses.
          </p>
          <Link
            to="/app/apps"
            className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            Open marketplace
          </Link>
        </div>
      </Card>
    </Section>
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

  // The e-mail channel is server-side (FR-MOD-13.8): the API sends it, so the
  // preference lives on the account rather than in this browser. Read it from
  // the signed-in agent and write it back through the store.
  const notifyEmail = useAuth((s) => s.agent?.notify_email ?? true);
  const setNotifyEmail = useAuth((s) => s.setNotifyEmail);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState(false);

  async function toggleEmail(next: boolean): Promise<void> {
    setEmailBusy(true);
    setEmailError(false);
    try {
      await setNotifyEmail(next);
    } catch {
      setEmailError(true);
    } finally {
      setEmailBusy(false);
    }
  }

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
      description="How you are alerted to new messages. Sound and desktop are per-browser; e-mail follows your account."
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

          <label className="flex items-center gap-3 p-4">
            <input
              type="checkbox"
              checked={notifyEmail}
              disabled={emailBusy}
              onChange={(event) => void toggleEmail(event.target.checked)}
            />
            <span className="flex-1 text-sm">
              Email notifications
              <span className="block text-2xs text-content-tertiary">
                {emailError
                  ? 'Could not save — please try again.'
                  : 'Emailed when a visitor writes in a chat assigned to you, even when Nexa is closed. Applies to your account.'}
              </span>
            </span>
            <StatusDot
              tone={notifyEmail ? 'success' : 'neutral'}
              label={notifyEmail ? 'On' : 'Off'}
            />
          </label>
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

// --- Banned customer IPs -----------------------------------------------------

/**
 * The address-based half of banning a visitor (FR-MOD-08.9.2).
 *
 * Banning a *customer* from the directory travels with their identity; a visitor
 * who clears cookies comes back as someone new. Blocking the IP closes that: an
 * address on this list is refused a widget token and cannot open or continue a
 * chat. Stored on the same `SecuritySettings` row as file sharing, so it shares
 * that query — a save here returns the whole record and both screens stay in
 * step.
 */
export function BannedCustomerIps({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [ip, setIp] = useState('');

  const settings = useQuery({
    queryKey: ['settings', 'security'],
    queryFn: () => api.get<SecuritySettings>('/settings/security'),
  });

  const save = useMutation({
    mutationFn: (banned_customer_ips: string[]) =>
      api.patch<SecuritySettings>('/settings/security', { banned_customer_ips }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'security'], data);
      setIp('');
    },
  });

  const banned = settings.data?.banned_customer_ips ?? [];

  function submit(event: FormEvent): void {
    event.preventDefault();
    const value = ip.trim();
    // The server validates and dedupes; skipping an obvious duplicate here just
    // avoids a pointless round-trip that would come back unchanged.
    if (!value || banned.includes(value)) return;
    save.mutate([...banned, value]);
  }

  return (
    <Section
      title="Blocked IP addresses"
      description="A visitor on one of these addresses is refused a chat, even from a fresh session. To ban a named contact instead, use the block action on their profile in Customers."
    >
      {settings.error ? (
        <ErrorNotice message="Could not load blocked addresses." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={submit}
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="new-banned-ip" className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  IP address
                </span>
                <input
                  id="new-banned-ip"
                  value={ip}
                  disabled={settings.isPending}
                  onChange={(event) => setIp(event.target.value)}
                  placeholder="203.0.113.5"
                  className="rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none placeholder:text-content-tertiary"
                />
                <span className="text-2xs text-content-tertiary">
                  An IPv4 or IPv6 address. The visitor is blocked until you remove it here.
                </span>
              </label>

              <button
                type="submit"
                disabled={!ip.trim() || settings.isPending || save.isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {save.isPending ? 'Saving…' : 'Block address'}
              </button>

              {save.isError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {save.error instanceof ApiClientError
                    ? save.error.message
                    : 'Could not block that address.'}
                </p>
              )}
            </form>
          )}

          {settings.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : banned.length === 0 ? (
            <EmptyState
              title="No blocked addresses"
              description="Add an IP address to refuse chats from it. Nothing is blocked until you do."
            />
          ) : (
            <ul className="divide-y divide-border">
              {banned.map((entry) => (
                <li key={entry} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 font-mono text-sm">{entry}</span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => save.mutate(banned.filter((value) => value !== entry))}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
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

// --- Audit log ----------------------------------------------------------------

/**
 * The door into the security trail (NFR-S12) — Integrations' pattern: a full
 * page's worth of list lives behind its own route, not a form field here.
 * Hidden entirely without `audit_log--all:ro`, so a teammate who cannot read
 * the trail is not shown a door that only leads to a 403. That hiding is a
 * courtesy, not the boundary — the route itself carries the real gate (scope +
 * `minimumRole: admin`, see `apps/api/src/routes/audit-log.ts`).
 */
export function AuditLog(): ReactElement | null {
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  if (!scopes.includes('audit_log--all:ro')) return null;

  return (
    <Section
      title="Audit log"
      description="Sign-ins, role changes, deletions and webhook changes — the last 30 days, kept for every plan."
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-content-secondary">
            Review who did what across this workspace.
          </p>
          <Link
            to="/app/settings/audit-log"
            className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            Open audit log
          </Link>
        </div>
      </Card>
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

export function CannedResponses({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

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
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/canned-responses/${id}`),
    onSuccess: invalidate,
  });

  // The one validation primitive: both fields required, Submit disabled until
  // they are, the fields cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { shortcut: '', text: '' },
    validators: { shortcut: required('Enter a shortcut.'), text: required('Enter the reply text.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({ shortcut: values.shortcut.trim(), text: values.text.trim() });
        reset();
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : 'Could not save that reply.');
      }
    },
  });
  const shortcutError = form.errorFor('shortcut');
  const textError = form.errorFor('text');

  return (
    <Section title="Saved replies" description="Agents insert these by typing # in the composer.">
      {list.error ? (
        <ErrorNotice message="Could not load saved replies." />
      ) : (
        <Card>
          {canEdit && (
            <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3 border-b border-border p-4">
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
                      value={form.values.shortcut}
                      onChange={(event) => form.setValue('shortcut', event.target.value)}
                      onBlur={() => form.blur('shortcut')}
                      aria-invalid={shortcutError ? true : undefined}
                      aria-describedby={shortcutError ? 'new-shortcut-error' : undefined}
                      placeholder="shipping"
                      className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  </div>
                  <FieldError id="new-shortcut-error" message={shortcutError} />
                </label>

                <label htmlFor="new-reply" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Reply
                  </span>
                  <input
                    id="new-reply"
                    value={form.values.text}
                    onChange={(event) => form.setValue('text', event.target.value)}
                    onBlur={() => form.blur('text')}
                    aria-invalid={textError ? true : undefined}
                    aria-describedby={textError ? 'new-reply-error' : undefined}
                    placeholder="Standard delivery takes 3-5 working days."
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-reply-error" message={textError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Saving…' : 'Save reply'}
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
export function Tags({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

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
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/tags/${id}`),
    onSuccess: invalidate,
  });

  // The one validation primitive: a name is required, Submit disabled until it
  // is present, the field cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { name: '' },
    validators: { name: required('Enter a tag name.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({ name: values.name.trim() });
        reset();
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : 'Could not add that tag.');
      }
    },
  });
  const nameError = form.errorFor('name');

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
            <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-tag-name" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Tag
                  </span>
                  <input
                    id="new-tag-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'new-tag-name-error' : undefined}
                    placeholder="vip"
                    maxLength={64}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-tag-name-error" message={nameError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Adding…' : 'Add tag'}
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

// --- Skills (expertise catalogue) ---------------------------------------------

/**
 * The catalogue skill-based routing draws on (FR-MOD-08.6.3): create a skill
 * here, then require it in a routing rule's conditions or assign it to an
 * agent in Team. Deleting one also drops it from any routing rule or agent
 * that referenced it — the server cascades that, this screen just reflects it
 * on the next load.
 */
export function Skills({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: Expertise[] }>('/settings/expertise'),
  });

  const create = useMutation({
    mutationFn: (body: { name: string }) => api.post<Expertise>('/settings/expertise', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'expertise'] });
    },
  });

  // Delete moves the row out at once, rolling back if the server refuses —
  // the same optimistic behaviour the routing rules use (FR-EK-A.2).
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/settings/expertise/${id}`),
    ...optimisticCacheUpdate<{ items: Expertise[] }, number>({
      queryClient,
      queryKey: ['settings', 'expertise'],
      update: (current, id) => ({
        items: (current?.items ?? []).filter((skill) => skill.id !== id),
      }),
    }),
  });

  // The one validation primitive: a name is required, Submit disabled until it
  // is present, the field cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { name: '' },
    validators: { name: required('Name the skill.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({ name: values.name.trim() });
        reset();
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : 'Could not add that skill.');
      }
    },
  });
  const nameError = form.errorFor('name');

  return (
    <Section
      title="Skills"
      description="Areas of expertise. Require one in a routing rule, or assign one to an agent in Team."
    >
      {list.error ? (
        <ErrorNotice message="Could not load skills." />
      ) : (
        <Card>
          {canEdit && (
            <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-skill-name" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Skill
                  </span>
                  <input
                    id="new-skill-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'new-skill-name-error' : undefined}
                    placeholder="Billing"
                    maxLength={EXPERTISE_NAME_MAX_LENGTH}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-skill-name-error" message={nameError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Adding…' : 'Add skill'}
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
              title="No skills yet"
              description="Add a skill to require it in a routing rule or assign it to an agent in Team."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((skill) => (
                <li key={skill.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm">{skill.name}</span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(skill.id)}
                      aria-label={`Delete skill ${skill.name}`}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
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

export function RoutingRules({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'routing-rules'],
    queryFn: () => api.get<{ items: RoutingRule[] }>('/settings/routing-rules'),
  });

  // Routing rules reference skills by id (`conditions.expertise_ids`); this
  // resolves them to names for display. Same cache key the Skills section
  // above uses, so mounting both costs one fetch, not two.
  const skills = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: Expertise[] }>('/settings/expertise'),
  });
  const skillNameById = new Map((skills.data?.items ?? []).map((skill) => [skill.id, skill.name]));

  // Flip the switch under the pointer at once: a toggle that waits for the round
  // trip feels broken. The shared optimistic helper writes the new state now and
  // rolls it back if the server refuses, so the UI never keeps a change that did
  // not take (FR-EK-A.2).
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<RoutingRule>(`/settings/routing-rules/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: RoutingRule[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'routing-rules'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((rule) =>
          rule.id === id ? { ...rule, enabled } : rule,
        ),
      }),
    }),
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
                      {describeConditions(rule.conditions, skillNameById)} →{' '}
                      {rule.target_group_name ?? 'no team'}
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

/**
 * Renders the condition JSON as something an admin can read at a glance.
 * `expertise_ids` (FR-MOD-08.6.3) is resolved to skill names via `skillNameById`
 * rather than shown as raw ids; an id with no matching skill (deleted since the
 * rule was written) falls back to `#<id>` instead of disappearing silently.
 */
function describeConditions(
  conditions: Record<string, unknown>,
  skillNameById: Map<number, string> = new Map(),
): string {
  const entries = Object.entries(conditions ?? {});
  if (entries.length === 0) return 'Anything';
  return entries
    .map(([key, value]) => {
      if (key === 'expertise_ids' && Array.isArray(value)) {
        const names = value.map((id: unknown) => skillNameById.get(Number(id)) ?? `#${String(id)}`);
        return `skill ${names.join(', ')}`;
      }
      return `${key.replace(/_/g, ' ')} ${String(value)}`;
    })
    .join(' and ');
}

// --- Ticket rules ------------------------------------------------------------

/**
 * Ticket rules (FR-MOD-08.6.2): a condition plus an action, applied when a
 * ticket is opened. The editor covers the two self-contained actions — set
 * priority, add a tag — while assignment rules are configured through the API;
 * both share the same condition. A condition and an action are always required,
 * which the form enforces before the server ever does (the "koşul+eylem
 * zorunlu" KK): the subject fragment and the action value are both required.
 */
export function TicketRules({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'ticket-rules'],
    queryFn: () => api.get<{ items: TicketRule[] }>('/settings/ticket-rules'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'ticket-rules'] });
  };

  const create = useMutation({
    mutationFn: (body: {
      name: string;
      conditions: TicketRule['conditions'];
      actions: TicketRule['actions'];
    }) => api.post<TicketRule>('/settings/ticket-rules', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/ticket-rules/${id}`),
    onSuccess: invalidate,
  });

  // Flip the switch under the pointer at once, rolling back if the server
  // refuses — the same optimistic behaviour the routing rules use (FR-EK-A.2).
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<TicketRule>(`/settings/ticket-rules/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: TicketRule[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'ticket-rules'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
      }),
    }),
  });

  // Name, a subject condition and an action value are all required, Submit
  // disabled until they are, the fields cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { name: '', subject_contains: '', action_type: 'priority', value: '' },
    validators: {
      name: required('Name the rule.'),
      subject_contains: required('Enter the text the subject must contain.'),
      value: required('Enter a value for the action.'),
    },
    onSubmit: async (values, { setSubmitError, setFieldError, reset }) => {
      const conditions = { subject_contains: values.subject_contains.trim() };
      let actions: TicketRule['actions'];
      if (values.action_type === 'priority') {
        const priority = Number(values.value);
        if (!Number.isInteger(priority) || priority < 0) {
          setFieldError('value', 'Enter a whole number, 0 or more.');
          return;
        }
        actions = { priority };
      } else {
        actions = { add_tag: values.value.trim() };
      }
      try {
        await create.mutateAsync({ name: values.name.trim(), conditions, actions });
        reset();
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : 'Could not save that rule.');
      }
    },
  });
  const nameError = form.errorFor('name');
  const subjectError = form.errorFor('subject_contains');
  const valueError = form.errorFor('value');
  const isPriority = form.values.action_type === 'priority';

  return (
    <Section
      title="Ticket rules"
      description="When a ticket is opened, the first matching rule sets its priority or applies a tag."
    >
      {list.error ? (
        <ErrorNotice message="Could not load ticket rules." />
      ) : (
        <Card>
          {canEdit && (
            <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="rule-name" className="flex w-40 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Rule name
                  </span>
                  <input
                    id="rule-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'rule-name-error' : undefined}
                    placeholder="Refunds"
                    maxLength={120}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="rule-name-error" message={nameError} />
                </label>

                <label htmlFor="rule-subject" className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    When subject contains
                  </span>
                  <input
                    id="rule-subject"
                    value={form.values.subject_contains}
                    onChange={(event) => form.setValue('subject_contains', event.target.value)}
                    onBlur={() => form.blur('subject_contains')}
                    aria-invalid={subjectError ? true : undefined}
                    aria-describedby={subjectError ? 'rule-subject-error' : undefined}
                    placeholder="refund"
                    maxLength={2048}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="rule-subject-error" message={subjectError} />
                </label>

                <label htmlFor="rule-action" className="flex w-32 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    Then
                  </span>
                  <select
                    id="rule-action"
                    value={form.values.action_type}
                    onChange={(event) => {
                      // Switching action kind changes what the value means, so
                      // clear it rather than carry a priority into a tag field.
                      form.setValue('action_type', event.target.value);
                      form.setValue('value', '');
                    }}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="priority">Set priority</option>
                    <option value="tag">Add tag</option>
                  </select>
                </label>

                <label htmlFor="rule-value" className="flex w-32 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {isPriority ? 'Priority' : 'Tag'}
                  </span>
                  <input
                    id="rule-value"
                    type={isPriority ? 'number' : 'text'}
                    min={isPriority ? 0 : undefined}
                    value={form.values.value}
                    onChange={(event) => form.setValue('value', event.target.value)}
                    onBlur={() => form.blur('value')}
                    aria-invalid={valueError ? true : undefined}
                    aria-describedby={valueError ? 'rule-value-error' : undefined}
                    placeholder={isPriority ? '50' : 'vip'}
                    maxLength={isPriority ? undefined : 64}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="rule-value-error" message={valueError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Saving…' : 'Add rule'}
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
              title="No ticket rules"
              description="Auto-assign, prioritise or tag tickets the moment they are opened."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{rule.name}</p>
                    <p className="truncate text-2xs text-content-tertiary">{describeTicketRule(rule)}</p>
                  </div>

                  <StatusDot
                    tone={rule.enabled ? 'success' : 'neutral'}
                    label={rule.enabled ? 'On' : 'Off'}
                  />

                  {canEdit && (
                    <>
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: rule.id, enabled: !rule.enabled })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
                      >
                        {rule.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove.mutate(rule.id)}
                        aria-label={`Delete rule ${rule.name}`}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        Delete
                      </button>
                    </>
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

/** Renders a ticket rule as one readable "when … → then …" line. */
function describeTicketRule(rule: TicketRule): string {
  const when: string[] = [];
  if (rule.conditions.subject_contains) when.push(`subject contains “${rule.conditions.subject_contains}”`);
  if (rule.conditions.source) when.push(`from ${rule.conditions.source}`);

  const then: string[] = [];
  if (rule.actions.assign_agent_id) then.push('assign to an agent');
  if (rule.actions.assign_group_id != null) then.push('assign to a team');
  if (rule.actions.priority != null) then.push(`set priority ${rule.actions.priority}`);
  if (rule.actions.add_tag) then.push(`add tag “${rule.actions.add_tag}”`);

  return `${when.length ? when.join(' and ') : 'any ticket'} → ${then.length ? then.join(', ') : 'do nothing'}`;
}

// --- Ticket e-mail templates -------------------------------------------------

/**
 * A validator for one half of a template (FR-MOD-08.7.5). It answers exactly the
 * question the server will, from the same catalogue (`@nexa/types`): an unknown
 * variable or a malformed `{{…}}` becomes a field-under error the moment it is
 * typed, so the author never round-trips to the server to learn a placeholder is
 * wrong (KK "Geçersiz değişken/format engeli").
 */
function templateText(field: TemplateField): Validator {
  return (value) => findTemplateProblems(field, value)[0]?.message ?? null;
}

/**
 * Author branded, variabled e-mails a ticket can send (FR-MOD-08.7.5). The one
 * property that matters is that Submit stays disabled — and a field-under error
 * shows — while the subject or body names a variable the product cannot fill or
 * carries a broken placeholder, judged live against the shared catalogue.
 */
export function TicketEmailTemplates({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'ticket-email-templates'],
    queryFn: () => api.get<{ items: TicketEmailTemplate[] }>('/settings/ticket-email-templates'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'ticket-email-templates'] });
  };

  const create = useMutation({
    mutationFn: (body: { name: string; subject: string; body: string }) =>
      api.post<TicketEmailTemplate>('/settings/ticket-email-templates', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/ticket-email-templates/${id}`),
    onSuccess: invalidate,
  });

  // Flip the switch under the pointer at once, rolling back if the server
  // refuses — the same optimistic behaviour ticket rules use (FR-EK-A.2).
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<TicketEmailTemplate>(`/settings/ticket-email-templates/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: TicketEmailTemplate[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'ticket-email-templates'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((t) => (t.id === id ? { ...t, enabled } : t)),
      }),
    }),
  });

  // Name, subject and body are all required, and the subject and body must carry
  // only valid placeholders — Submit disabled until they do (FR-EK-A.1).
  const form = useForm({
    initial: { name: '', subject: '', body: '' },
    validators: {
      name: required('Name the template.'),
      subject: compose(required('Enter a subject.'), templateText('subject')),
      body: compose(required('Enter the message body.'), templateText('body')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          name: values.name.trim(),
          subject: values.subject,
          body: values.body,
        });
        reset();
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not save that template.',
        );
      }
    },
  });
  const nameError = form.errorFor('name');
  const subjectError = form.errorFor('subject');
  const bodyError = form.errorFor('body');

  return (
    <Section
      title="Ticket email templates"
      description="Branded, reusable replies. Insert a variable with double braces, e.g. {{ticket.id}}."
    >
      {list.error ? (
        <ErrorNotice message="Could not load email templates." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <label htmlFor="template-name" className="flex w-56 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Template name
                </span>
                <input
                  id="template-name"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.blur('name')}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'template-name-error' : undefined}
                  placeholder="Ticket received"
                  maxLength={120}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="template-name-error" message={nameError} />
              </label>

              <label htmlFor="template-subject" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Subject
                </span>
                <input
                  id="template-subject"
                  value={form.values.subject}
                  onChange={(event) => form.setValue('subject', event.target.value)}
                  onBlur={() => form.blur('subject')}
                  aria-invalid={subjectError ? true : undefined}
                  aria-describedby={subjectError ? 'template-subject-error' : undefined}
                  placeholder="We received your ticket {{ticket.id}}"
                  maxLength={200}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="template-subject-error" message={subjectError} />
              </label>

              <label htmlFor="template-body" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Message
                </span>
                <textarea
                  id="template-body"
                  value={form.values.body}
                  onChange={(event) => form.setValue('body', event.target.value)}
                  onBlur={() => form.blur('body')}
                  aria-invalid={bodyError ? true : undefined}
                  aria-describedby={bodyError ? 'template-body-error' : undefined}
                  placeholder="Hi {{customer.name}}, thanks for reaching out."
                  maxLength={10000}
                  rows={4}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="template-body-error" message={bodyError} />
              </label>

              <p className="text-2xs text-content-tertiary">
                Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', ')}
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? 'Saving…' : 'Add template'}
                </button>
                {form.submitError && (
                  <p role="alert" className="text-2xs text-danger">
                    {form.submitError}
                  </p>
                )}
              </div>
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No email templates"
              description="Author a branded, variabled reply your team can send on a ticket."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((template) => (
                <li key={template.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="truncate text-2xs text-content-tertiary">{template.subject}</p>
                  </div>

                  <StatusDot
                    tone={template.enabled ? 'success' : 'neutral'}
                    label={template.enabled ? 'On' : 'Off'}
                  />

                  {canEdit && (
                    <>
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: template.id, enabled: !template.enabled })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
                      >
                        {template.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove.mutate(template.id)}
                        aria-label={`Delete template ${template.name}`}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        Delete
                      </button>
                    </>
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

// --- Custom fields -----------------------------------------------------------

/**
 * Define custom fields on tickets and contacts (FR-MOD-08.7.6). A field carries
 * the two properties the requirement turns on: a `type`, which decides how a
 * value is validated, and whether it is `required`. Once defined, a field shows
 * up on the ticket Details pane and in the CRM, where its values are set. The
 * label and a chosen type are required to add one (FR-EK-A.1), and a duplicate
 * label on the same entity is refused by the server.
 */
export function CustomFieldsSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [isRequired, setIsRequired] = useState(false);

  const list = useQuery({
    queryKey: ['settings', 'custom-fields'],
    queryFn: () => api.get<{ items: CustomFieldDefinition[] }>('/settings/custom-fields'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'custom-fields'] });

  const create = useMutation({
    mutationFn: (body: {
      entity: CustomFieldEntity;
      label: string;
      type: CustomFieldType;
      required: boolean;
    }) => api.post<CustomFieldDefinition>('/settings/custom-fields', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/custom-fields/${id}`),
    onSuccess: invalidate,
  });

  // Label, entity and type are all needed; the label is the one that can be
  // typed wrong, so it carries the field-under validation (FR-EK-A.1).
  const form = useForm({
    initial: { label: '', entity: 'ticket', type: 'text' },
    validators: { label: required('Name the field.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          entity: values.entity as CustomFieldEntity,
          label: values.label.trim(),
          type: values.type as CustomFieldType,
          required: isRequired,
        });
        reset();
        setIsRequired(false);
      } catch (error) {
        setSubmitError(error instanceof ApiClientError ? error.message : 'Could not add that field.');
      }
    },
  });
  const labelError = form.errorFor('label');

  return (
    <Section
      title="Custom fields"
      description="Extra fields on tickets and contacts — a player id, a KYC status, a balance. They appear on the ticket Details pane and in the CRM."
    >
      {list.error ? (
        <ErrorNotice message="Could not load custom fields." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="cf-label" className="flex w-48 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Label
                </span>
                <input
                  id="cf-label"
                  value={form.values.label}
                  onChange={(event) => form.setValue('label', event.target.value)}
                  onBlur={() => form.blur('label')}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? 'cf-label-error' : undefined}
                  placeholder="Player ID"
                  maxLength={120}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="cf-label-error" message={labelError} />
              </label>

              <label htmlFor="cf-entity" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  On
                </span>
                <select
                  id="cf-entity"
                  value={form.values.entity}
                  onChange={(event) => form.setValue('entity', event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  {CUSTOM_FIELD_ENTITIES.map((entity) => (
                    <option key={entity} value={entity}>
                      {entity === 'ticket' ? 'Ticket' : 'Contact'}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="cf-type" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Type
                </span>
                <select
                  id="cf-type"
                  value={form.values.type}
                  onChange={(event) => form.setValue('type', event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  {CUSTOM_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 pb-1.5 text-sm text-content-secondary">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(event) => setIsRequired(event.target.checked)}
                />
                Required
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? 'Adding…' : 'Add field'}
              </button>

              {form.submitError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title="No custom fields"
              description="Add fields your team needs on tickets and contacts, like a player id or a KYC status."
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((field) => (
                <li key={field.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm font-medium">{field.label}</span>
                  <span className="text-2xs text-content-tertiary">
                    {field.entity === 'ticket' ? 'Ticket' : 'Contact'} · {field.type}
                    {field.required ? ' · required' : ''}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(field.id)}
                      aria-label={`Delete field ${field.label}`}
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

/**
 * Pre-chat form builder (FR-MOD-08.7.7).
 *
 * A field asked in the widget before the conversation starts. Each is a contact
 * custom field flagged `pre_chat`, so an answer is validated by its `type` (KK
 * "tip validasyon") and lands on the contact like any other field (KK "widget'ta
 * gösterim → contact'a yazma") — visible in the CRM, no parallel store. "At least
 * one field": the widget shows the form only once one exists here.
 */
export function PreChatFormSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [isRequired, setIsRequired] = useState(false);

  const list = useQuery({
    queryKey: ['settings', 'custom-fields', 'pre-chat'],
    queryFn: () =>
      api.get<{ items: CustomFieldDefinition[] }>('/settings/custom-fields?entity=contact'),
  });

  // Prefix-invalidate so the CRM custom-fields list refreshes too: a pre-chat
  // field is a contact custom field, and it appears in both places.
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'custom-fields'] });

  const create = useMutation({
    mutationFn: (body: { label: string; type: CustomFieldType; required: boolean }) =>
      api.post<CustomFieldDefinition>('/settings/custom-fields', {
        entity: 'contact',
        form_placement: 'pre_chat',
        ...body,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/custom-fields/${id}`),
    onSuccess: invalidate,
  });

  const form = useForm({
    initial: { label: '', type: 'text' },
    validators: { label: required('Name the field.') },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          label: values.label.trim(),
          type: values.type as CustomFieldType,
          required: isRequired,
        });
        reset();
        setIsRequired(false);
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not add that field.',
        );
      }
    },
  });
  const labelError = form.errorFor('label');

  // Only the pre-chat fields: the query returns every contact field, but this
  // builder is about the ones that show in the widget.
  const fields = (list.data?.items ?? []).filter((field) => field.form_placement === 'pre_chat');

  return (
    <Section
      title="Pre-chat form"
      description="Ask visitors for details before the chat starts. Answers are saved to the contact and shown in the CRM."
    >
      {list.error ? (
        <ErrorNotice message="Could not load the pre-chat form." />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="pcf-label" className="flex w-48 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Label
                </span>
                <input
                  id="pcf-label"
                  value={form.values.label}
                  onChange={(event) => form.setValue('label', event.target.value)}
                  onBlur={() => form.blur('label')}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? 'pcf-label-error' : undefined}
                  placeholder="Order number"
                  maxLength={120}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="pcf-label-error" message={labelError} />
              </label>

              <label htmlFor="pcf-type" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Type
                </span>
                <select
                  id="pcf-type"
                  value={form.values.type}
                  onChange={(event) => form.setValue('type', event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  {CUSTOM_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 pb-1.5 text-sm text-content-secondary">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(event) => setIsRequired(event.target.checked)}
                />
                Required
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? 'Adding…' : 'Add field'}
              </button>

              {form.submitError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : fields.length === 0 ? (
            <EmptyState
              title="No pre-chat questions"
              description="Add a field to ask visitors for details — an order number, an account id — before they start chatting."
            />
          ) : (
            <ul className="divide-y divide-border">
              {fields.map((field) => (
                <li key={field.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm font-medium">{field.label}</span>
                  <span className="text-2xs text-content-tertiary">
                    {field.type}
                    {field.required ? ' · required' : ''}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(field.id)}
                      aria-label={`Delete field ${field.label}`}
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
