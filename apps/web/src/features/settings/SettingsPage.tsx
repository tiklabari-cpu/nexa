/**
 * Settings — the composition root for every section on the page.
 *
 * Several sections live in their own file (`TrustedDomains.tsx`,
 * `CannedResponses.tsx`, `Tags.tsx`, `TicketEmailTemplates.tsx`,
 * `CustomFieldsSettings.tsx`, `PreChatFormSettings.tsx`, `Integrations.tsx`, …)
 * rather than here, so each could be claimed translated by the i18n coverage
 * sentinel on its own (`NotificationSettings.tsx`'s precedent, I18N-e, tm
 * 133.5) without waiting for the whole page. This file still owns the sections
 * I18N-j (tm 133.10) has not translated yet — banned IPs, the audit log door,
 * file sharing, skills, routing and ticket rules — plus the `<Page>` shell
 * itself, so it stays untranslated (and unregistered) until that task finishes
 * the rest.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorNotice, Page, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { EXPERTISE_NAME_MAX_LENGTH } from '@nexa/types';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';
import { Brands } from './Brands.js';
import { McpConnection } from './McpConnection.js';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { WidgetCustomization } from './WidgetCustomization.js';
import { SalesTracker } from './SalesTracker.js';
import { ChannelsGrid } from './Channels.js';
import { IpAllowlist } from './IpAllowlist.js';
import { SsoConnection } from './SsoConnection.js';
import { Compliance } from './Compliance.js';
import { SiemExport } from './SiemExport.js';
import { SlaPolicy } from './SlaPolicy.js';
import { Sandbox } from './Sandbox.js';
import { ScheduledExports } from './ScheduledExports.js';
import { NotificationSettings } from './NotificationSettings.js';
import { Integrations } from './Integrations.js';
import { TrustedDomains } from './TrustedDomains.js';
import { CannedResponses } from './CannedResponses.js';
import { Tags } from './Tags.js';
import { TicketEmailTemplates } from './TicketEmailTemplates.js';
import { CustomFieldsSettings } from './CustomFieldsSettings.js';
import { PreChatFormSettings } from './PreChatFormSettings.js';

export { NotificationSettings } from './NotificationSettings.js';
export { Integrations } from './Integrations.js';
export { TrustedDomains } from './TrustedDomains.js';
export { CannedResponses } from './CannedResponses.js';
export { Tags } from './Tags.js';
export { TicketEmailTemplates } from './TicketEmailTemplates.js';
export { CustomFieldsSettings } from './CustomFieldsSettings.js';
export { PreChatFormSettings } from './PreChatFormSettings.js';

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
  actions: {
    assign_agent_id?: string;
    assign_group_id?: number;
    priority?: number;
    add_tag?: string;
  };
  enabled: boolean;
  position: number;
}

export function SettingsPage(): ReactElement {
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canManageAccess = scopes.includes('access_rules:rw');
  const canManageReplies = scopes.includes('canned_responses--all:rw');
  const canManageTags = scopes.includes('tags--all:rw');
  const canManageTicketRules = scopes.includes('tickets--all:rw');
  const canManageBrands = scopes.includes('brands--all:rw');
  const canManageScheduledExports = scopes.includes('reports_manage');

  return (
    <Page title="Settings" description="Widget installation, saved replies and routing.">
      <ChannelsGrid />
      <Integrations />
      <McpConnection />
      <NotificationSettings />
      <Brands canEdit={canManageBrands} />
      <WebsiteWidgets canEdit={canManageAccess} />
      <WidgetCustomization canEdit={canManageAccess} />
      <SalesTracker canEdit={canManageAccess} />
      <TrustedDomains canEdit={canManageAccess} />
      <BannedCustomerIps canEdit={canManageAccess} />
      <IpAllowlist canEdit={canManageAccess} />
      <SsoConnection canEdit={canManageAccess} />
      <Compliance canEdit={canManageAccess} />
      <SiemExport canEdit={canManageAccess} />
      <SlaPolicy canEdit={canManageAccess} />
      <Sandbox canEdit={canManageAccess} />
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
      <ScheduledExports canEdit={canManageScheduledExports} />
    </Page>
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
  const sizeDraft =
    sizeMb ?? (current ? String(Math.round(current.max_file_size_bytes / 1048576)) : '');

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
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not add that skill.',
        );
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
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
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
        items: (current?.items ?? []).map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
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
        setSubmitError(
          error instanceof ApiClientError ? error.message : 'Could not save that rule.',
        );
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
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
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
                    <p className="truncate text-2xs text-content-tertiary">
                      {describeTicketRule(rule)}
                    </p>
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
  if (rule.conditions.subject_contains)
    when.push(`subject contains “${rule.conditions.subject_contains}”`);
  if (rule.conditions.source) when.push(`from ${rule.conditions.source}`);

  const then: string[] = [];
  if (rule.actions.assign_agent_id) then.push('assign to an agent');
  if (rule.actions.assign_group_id != null) then.push('assign to a team');
  if (rule.actions.priority != null) then.push(`set priority ${rule.actions.priority}`);
  if (rule.actions.add_tag) then.push(`add tag “${rule.actions.add_tag}”`);

  return `${when.length ? when.join(' and ') : 'any ticket'} → ${then.length ? then.join(', ') : 'do nothing'}`;
}
