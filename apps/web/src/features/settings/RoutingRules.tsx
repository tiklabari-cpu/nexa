/**
 * Settings → Routing rules (FR-MOD-08.6.2/08.6.3): checked in order, the
 * first rule whose conditions all match decides which team a conversation
 * goes to. Shares the expertise catalogue `Skills.tsx` manages — a condition
 * may name one or more skills, resolved to their names for display here.
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated. Existing tests still
 * import it through `./SettingsPage.js`'s re-export, untouched.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';

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

/** Local copy of `Skills.tsx`'s expertise shape — just enough to resolve a name. */
interface Expertise {
  id: number;
  name: string;
  slug: string;
}

export function RoutingRules({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
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
    <Section title={t('settings.routing.title')} description={t('settings.routing.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.routing.loadError')} />
      ) : (
        <Card>
          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.routing.empty.title')}
              description={t('settings.routing.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {rule.name ??
                        (rule.is_fallback
                          ? t('settings.routing.everythingElse')
                          : t('settings.routing.ruleLabel'))}
                      {rule.is_fallback && (
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-normal text-content-secondary">
                          {t('settings.routing.fallbackBadge')}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-2xs text-content-tertiary">
                      {describeConditions(t, rule.conditions, skillNameById)} →{' '}
                      {rule.target_group_name ?? t('settings.routing.noTeam')}
                    </p>
                  </div>

                  <StatusDot
                    tone={rule.enabled ? 'success' : 'neutral'}
                    label={rule.enabled ? t('settings.on') : t('settings.off')}
                  />

                  {canEdit && (
                    <button
                      type="button"
                      // The fallback cannot be turned off — conversations that
                      // match nothing would have nowhere to go, and the
                      // configuration would still look healthy.
                      disabled={rule.is_fallback || toggle.isPending}
                      title={
                        rule.is_fallback ? t('settings.routing.fallbackDisabledTitle') : undefined
                      }
                      onClick={() => toggle.mutate({ id: rule.id, enabled: !rule.enabled })}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {rule.enabled ? t('settings.disable') : t('settings.enable')}
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
 * Arbitrary condition keys (`target_group_id`, …) stay as formatted field
 * names rather than a translated phrase — there is no bounded dictionary of
 * condition shapes to translate them against, the same "kapsam dışı" call
 * ticket status/priority raw enums made elsewhere (I18N-f/g).
 */
function describeConditions(
  t: TFunction,
  conditions: Record<string, unknown>,
  skillNameById: Map<number, string> = new Map(),
): string {
  const entries = Object.entries(conditions ?? {});
  if (entries.length === 0) return t('settings.routing.anything');
  return entries
    .map(([key, value]) => {
      if (key === 'expertise_ids' && Array.isArray(value)) {
        const names = value.map((id: unknown) => skillNameById.get(Number(id)) ?? `#${String(id)}`);
        return t('settings.routing.conditionSkill', { names: names.join(', ') });
      }
      return `${key.replace(/_/g, ' ')} ${String(value)}`;
    })
    .join(t('settings.andJoiner'));
}
