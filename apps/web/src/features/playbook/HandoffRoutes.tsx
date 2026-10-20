/**
 * The workspace's hand-over routes (tm 307.3 · AI-12, shared with AU-01): the
 * "Rotalar" card of the hand-over settings.
 *
 * A route sends a conversation to a team for a key — a routing topic (one of
 * the six queue roles) or the reason the AI handed it over — for one brand or
 * every brand. It may require an expertise of whoever takes the conversation
 * (with none available the conversation waits in the team's queue rather than
 * reach an untrained agent) and fixes the priority it starts with. The team is
 * held by id, so renaming it keeps its routes; a team deleted later leaves the
 * route in place and the row says so.
 *
 * What a route matches is fixed once it is made: the form of an existing route
 * edits the team, the expertise and the priority — to match something else,
 * delete it and add another.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { HANDOFF_ROUTES_MAX, THREAD_PRIORITIES, type ThreadPriority } from '@siyahtus/types';
import { EmptyState } from '../../components/EmptyState.js';
import { LoadError } from '../../components/LoadError.js';
import { Card, CardSkeleton } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  BLANK_ROUTE_DRAFT,
  ROUTE_MATCH_TYPES,
  createBody,
  draftOfRoute,
  handoffRoutesKey,
  routeDraftProblems,
  routeErrorKey,
  routeKeyLabelKey,
  routeKeys,
  updateBody,
  type HandoffRoute,
  type RouteDraft,
} from './handoff-routes.js';
import { Select, smallButton, type TeamOption } from './ProcedureSections.js';

interface NamedOption {
  id: number | string;
  name: string;
}

function priorityLabel(t: TFunction, priority: ThreadPriority): string {
  return t(`playbook.handoff.rules.priority.${priority}`);
}

function routeTitle(t: TFunction, route: Pick<HandoffRoute, 'match_type' | 'match_key'>): string {
  return t('playbook.handoff.routes.title.item', {
    type: t(`playbook.handoff.routes.type.${route.match_type}`),
    key: t(routeKeyLabelKey(route.match_type, route.match_key)),
  });
}

export function HandoffRoutes({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  // `null` is closed; `'new'` a blank form; a route is edited in place.
  const [editing, setEditing] = useState<HandoffRoute | 'new' | null>(null);

  const list = useQuery({
    queryKey: handoffRoutesKey,
    queryFn: () => api.get<{ items: HandoffRoute[] }>('/handoff-routes'),
  });
  const teams = useQuery({
    queryKey: ['playbook', 'teams'],
    queryFn: () => api.get<{ items: TeamOption[] }>('/groups'),
    staleTime: 60_000,
  });
  const expertise = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: NamedOption[] }>('/settings/expertise'),
    staleTime: 60_000,
  });
  const brands = useQuery({
    queryKey: ['brands'],
    queryFn: () => api.get<{ items: NamedOption[] }>('/brands'),
    staleTime: 60_000,
  });
  const teamItems = teams.data?.items ?? [];
  const expertiseItems = expertise.data?.items ?? [];
  const brandItems = brands.data?.items ?? [];

  const refresh = () => void queryClient.invalidateQueries({ queryKey: handoffRoutesKey });
  const toggle = useMutation({
    mutationFn: (route: HandoffRoute) =>
      api.patch<HandoffRoute>(`/handoff-routes/${route.id}`, { active: !route.active }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (route: HandoffRoute) => api.delete(`/handoff-routes/${route.id}`),
    onSuccess: refresh,
  });

  const items = list.data?.items ?? [];
  const failure = toggle.error ?? remove.error;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4" data-testid="handoff-routes">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t('playbook.handoff.routes.heading')}</h3>
            <p className="mt-0.5 text-2xs text-content-tertiary">
              {t('playbook.handoff.routes.description')}
            </p>
          </div>
          {canEdit && editing === null && items.length < HANDOFF_ROUTES_MAX && (
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
            >
              {t('playbook.handoff.routes.new')}
            </button>
          )}
        </div>

        {list.isPending ? (
          <CardSkeleton rows={3} />
        ) : list.isError ? (
          <LoadError
            compact
            title={t('playbook.handoff.routes.loadFailed')}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        ) : (
          <>
            {editing !== null && (
              <RouteForm
                key={editing === 'new' ? 'new' : editing.id}
                route={editing === 'new' ? null : editing}
                teams={teamItems}
                expertise={expertiseItems}
                brands={brandItems}
                onClose={() => setEditing(null)}
                onSaved={() => {
                  setEditing(null);
                  refresh();
                }}
              />
            )}

            {items.length === 0 ? (
              <EmptyState
                title={t('playbook.handoff.routes.emptyTitle')}
                description={t('playbook.handoff.routes.emptyDescription')}
              />
            ) : (
              <ul
                aria-label={t('playbook.handoff.routes.listLabel')}
                className="flex flex-col gap-1.5"
              >
                {items.map((route) => {
                  const title = routeTitle(t, route);
                  const team = teamItems.find((candidate) => candidate.id === route.group_id);
                  const skill = expertiseItems.find(
                    (candidate) => candidate.id === route.required_expertise_id,
                  );
                  const brand = brandItems.find((candidate) => candidate.id === route.brand_id);
                  return (
                    <li
                      key={route.id}
                      data-testid={`handoff-route-${route.id}`}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 ${
                        route.active ? '' : 'text-content-tertiary'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{title}</p>
                        <p className="truncate text-2xs text-content-tertiary">
                          {route.brand_id === null
                            ? t('playbook.handoff.routes.allBrands')
                            : (brand?.name ?? t('playbook.handoff.routes.brandUnknown'))}
                          {' → '}
                          {/* A deleted team leaves its routes in place; say so. */}
                          {team ? team.name : t('playbook.procedure.targetUnknownTeam')}
                          {' · '}
                          {priorityLabel(t, route.default_priority)}
                          {route.required_expertise_id !== null &&
                            ` · ${
                              skill
                                ? t('playbook.handoff.routes.needs', { name: skill.name })
                                : t('playbook.handoff.routes.needsMissing')
                            }`}
                        </p>
                      </div>
                      <label className="flex items-center gap-1.5 text-2xs">
                        <input
                          type="checkbox"
                          checked={route.active}
                          disabled={!canEdit || toggle.isPending}
                          aria-label={t('playbook.handoff.routes.activeLabel', { title })}
                          onChange={() => toggle.mutate(route)}
                        />
                        {t('playbook.handoff.routes.active')}
                      </label>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditing(route)}
                            aria-label={t('playbook.handoff.routes.edit', { title })}
                            className={smallButton}
                          >
                            {t('playbook.handoff.routes.editShort')}
                          </button>
                          <button
                            type="button"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (
                                window.confirm(
                                  t('playbook.handoff.routes.deleteConfirm', { title }),
                                )
                              ) {
                                remove.mutate(route);
                              }
                            }}
                            aria-label={t('playbook.handoff.routes.delete', { title })}
                            className={`${smallButton} hover:text-danger`}
                          >
                            {t('playbook.handoff.routes.deleteShort')}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {failure && (
              <p role="alert" className="text-2xs text-danger">
                {t(routeErrorKey(failure))}
              </p>
            )}
            {!canEdit && (
              <p className="text-2xs text-content-tertiary">{t('playbook.handoff.readOnly')}</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The form.
// ---------------------------------------------------------------------------

function RouteForm({
  route,
  teams,
  expertise,
  brands,
  onClose,
  onSaved,
}: {
  route: HandoffRoute | null;
  teams: readonly TeamOption[];
  expertise: readonly NamedOption[];
  brands: readonly NamedOption[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [draft, setDraft] = useState<RouteDraft>(() =>
    route ? draftOfRoute(route) : BLANK_ROUTE_DRAFT,
  );
  const [showProblems, setShowProblems] = useState(false);
  const problems = routeDraftProblems(draft);

  const save = useMutation({
    mutationFn: () =>
      route
        ? api.patch<HandoffRoute>(`/handoff-routes/${route.id}`, updateBody(draft, route))
        : api.post<HandoffRoute>('/handoff-routes', createBody(draft)),
    onSuccess: onSaved,
  });

  const set = (patch: Partial<RouteDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const idPrefix = route ? `handoff-route-${route.id}` : 'handoff-route-new';
  const heading = route
    ? t('playbook.handoff.routes.formEdit')
    : t('playbook.handoff.routes.formNew');
  // What a route matches is fixed: only a new one picks it.
  const fixed = route !== null;
  // A team or an expertise the list no longer holds stays selectable, so an
  // edit of the priority does not silently re-point the route.
  const strayTeam =
    draft.groupId !== '' && !teams.some((team) => String(team.id) === draft.groupId);
  const strayExpertise =
    draft.expertiseId !== '' && !expertise.some((skill) => String(skill.id) === draft.expertiseId);

  return (
    <form
      noValidate
      aria-label={heading}
      onSubmit={(event) => {
        event.preventDefault();
        if (problems.length > 0) setShowProblems(true);
        else save.mutate();
      }}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <h4 className="text-sm font-semibold">{heading}</h4>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          id={`${idPrefix}-type`}
          label={t('playbook.handoff.routes.fieldType')}
          value={draft.matchType}
          disabled={fixed}
          options={ROUTE_MATCH_TYPES.map(
            (type) => [type, t(`playbook.handoff.routes.type.${type}`)] as const,
          )}
          onChange={(matchType) => set({ matchType, matchKey: routeKeys(matchType)[0] ?? '' })}
          className="w-40"
        />
        <Select
          id={`${idPrefix}-key`}
          label={t('playbook.handoff.routes.fieldKey')}
          value={draft.matchKey}
          disabled={fixed}
          options={routeKeys(draft.matchType).map(
            (key) => [key, t(routeKeyLabelKey(draft.matchType, key))] as const,
          )}
          onChange={(matchKey) => set({ matchKey })}
          className="w-64"
        />
        {(brands.length > 1 || draft.brandId !== '') && (
          <Select
            id={`${idPrefix}-brand`}
            label={t('playbook.handoff.routes.fieldBrand')}
            value={draft.brandId}
            disabled={fixed}
            options={[
              ['', t('playbook.handoff.routes.allBrands')] as const,
              ...brands.map((brand) => [String(brand.id), brand.name] as const),
              ...(draft.brandId !== '' && !brands.some((brand) => brand.id === draft.brandId)
                ? ([[draft.brandId, t('playbook.handoff.routes.brandUnknown')]] as const)
                : []),
            ]}
            onChange={(brandId) => set({ brandId })}
            className="w-48"
          />
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          id={`${idPrefix}-team`}
          label={t('playbook.handoff.routes.fieldTeam')}
          value={draft.groupId}
          disabled={false}
          options={[
            ['', t('playbook.handoff.routes.choose')] as const,
            ...teams.map((team) => [String(team.id), team.name] as const),
            ...(strayTeam
              ? ([[draft.groupId, t('playbook.procedure.targetUnknownTeam')]] as const)
              : []),
          ]}
          onChange={(groupId) => set({ groupId })}
          className="w-56"
        />
        <Select
          id={`${idPrefix}-expertise`}
          label={t('playbook.handoff.routes.fieldExpertise')}
          value={draft.expertiseId}
          disabled={false}
          options={[
            ['', t('playbook.handoff.routes.expertiseNone')] as const,
            ...expertise.map((skill) => [String(skill.id), skill.name] as const),
            ...(strayExpertise
              ? ([[draft.expertiseId, t('playbook.handoff.routes.needsMissing')]] as const)
              : []),
          ]}
          onChange={(expertiseId) => set({ expertiseId })}
          className="w-56"
        />
        <Select<ThreadPriority>
          id={`${idPrefix}-priority`}
          label={t('playbook.handoff.routes.fieldPriority')}
          value={draft.priority}
          disabled={false}
          options={THREAD_PRIORITIES.map(
            (priority) => [priority, priorityLabel(t, priority)] as const,
          )}
          onChange={(priority) => set({ priority })}
          className="w-40"
        />
      </div>
      {draft.expertiseId !== '' && (
        <p className="text-2xs text-content-tertiary">
          {t('playbook.handoff.routes.expertiseHint')}
        </p>
      )}

      {!route && (
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(event) => set({ active: event.target.checked })}
          />
          {t('playbook.handoff.routes.active')}
        </label>
      )}

      {showProblems && problems.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-2xs text-danger">
          {problems.map((key) => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      )}
      {save.isError && (
        <p role="alert" className="text-2xs text-danger">
          {t(routeErrorKey(save.error))}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {save.isPending ? t('playbook.handoff.saving') : t('playbook.handoff.routes.save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2"
        >
          {t('playbook.handoff.routes.cancel')}
        </button>
      </div>
    </form>
  );
}
