/**
 * Team → Chatbots: the rule bot editor (FR-MOD-06.6).
 *
 * PRD:577 asks for a chatbot that is separate from the AI Agent and carries no
 * LLM, and the Chatbots tab is where the PRD itself puts bot accounts
 * (FR-MOD-04.6). So this sits directly under the AI-agent list on the same page,
 * which is also the honest arrangement: a reader can see at a glance that the
 * workspace has two different kinds of automation and which of them will think
 * for itself.
 *
 * Everything an admin needs is here, because a rule bot that could only be
 * configured through the API would close the requirement on paper only: create
 * and delete a bot, switch it on and off, attach it to teams **with a priority**
 * (the KK's second half), and write, toggle and delete its rules.
 *
 * The priority picker is deliberately the same four-tier vocabulary — and the
 * same `GROUP_PRIORITIES` constant — the team-membership picker uses
 * (`TeamMembers.tsx`). One word, one meaning, one ordering.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GROUP_PRIORITIES, type GroupPriority } from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface RuleBotRule {
  id: string;
  name: string;
  conditions: {
    message_equals?: string;
    message_contains?: string;
    message_word?: string;
    page_url_contains?: string;
    office_hours?: 'open' | 'closed';
  };
  actions: {
    send_message?: string;
    add_tag?: string;
    transfer_to_group_id?: number;
  };
  enabled: boolean;
  position: number;
}

interface RuleBot {
  id: string;
  name: string;
  enabled: boolean;
  groups: Array<{ group_id: number; priority: string }>;
  rules: RuleBotRule[];
}

interface Team {
  id: number;
  name: string;
}

/** The condition kinds the editor offers, in the order they are most reached for. */
const CONDITION_KINDS = [
  'message_word',
  'message_contains',
  'message_equals',
  'page_url_contains',
] as const;
type ConditionKind = (typeof CONDITION_KINDS)[number];

/** The action kinds, likewise. */
const ACTION_KINDS = ['send_message', 'add_tag', 'transfer_to_group_id'] as const;
type ActionKind = (typeof ACTION_KINDS)[number];

const INPUT =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary';
const SMALL_BUTTON =
  'rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40';

export function RuleBots(): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const scopes = useAuth((s) => s.agent?.scopes ?? []);
  const canRead = scopes.includes('agents-bot--all:ro') || scopes.includes('agents-bot--all:rw');
  const canEdit = scopes.includes('agents-bot--all:rw');

  const bots = useQuery({
    queryKey: ['team', 'rule-bots'],
    queryFn: () => api.get<{ items: RuleBot[] }>('/settings/bots'),
    enabled: canRead,
  });

  // The teams a bot can be attached to. Same cache key `Teams.tsx` fills, so
  // opening this page after that one costs no second request.
  const teams = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
    enabled: canRead,
  });

  const invalidate = () => client.invalidateQueries({ queryKey: ['team', 'rule-bots'] });

  const createBot = useMutation({
    mutationFn: (body: { name: string }) => api.post<RuleBot>('/settings/bots', body),
    onSuccess: invalidate,
  });

  const patchBot = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch<RuleBot>(`/settings/bots/${id}`, body),
    onSuccess: invalidate,
  });

  const removeBot = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/bots/${id}`),
    onSuccess: invalidate,
  });

  const createRule = useMutation({
    mutationFn: ({ botId, ...body }: { botId: string } & Record<string, unknown>) =>
      api.post<RuleBotRule>(`/settings/bots/${botId}/rules`, body),
    onSuccess: invalidate,
  });

  const patchRule = useMutation({
    mutationFn: ({
      botId,
      ruleId,
      ...body
    }: { botId: string; ruleId: string } & Record<string, unknown>) =>
      api.patch<RuleBotRule>(`/settings/bots/${botId}/rules/${ruleId}`, body),
    onSuccess: invalidate,
  });

  const removeRule = useMutation({
    mutationFn: ({ botId, ruleId }: { botId: string; ruleId: string }) =>
      api.delete(`/settings/bots/${botId}/rules/${ruleId}`),
    onSuccess: invalidate,
  });

  const botForm = useForm({
    initial: { name: '' },
    validators: { name: required(t('team.ruleBots.nameError')) },
    onSubmit: async (values, { reset, setSubmitError }) => {
      try {
        await createBot.mutateAsync({ name: values.name.trim() });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const botNameError = botForm.errorFor('name');

  if (!canRead) {
    return (
      <Section title={t('team.ruleBots.title')} description={t('team.ruleBots.description')}>
        <Card>
          <EmptyState
            title={t('team.ruleBots.noAccess.title')}
            description={t('team.ruleBots.noAccess.description')}
          />
        </Card>
      </Section>
    );
  }

  return (
    <Section title={t('team.ruleBots.title')} description={t('team.ruleBots.description')}>
      {bots.error ? (
        <ErrorNotice message={t('team.ruleBots.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={botForm.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="rule-bot-name" className="flex w-56 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('team.ruleBots.nameLabel')}
                  </span>
                  <input
                    id="rule-bot-name"
                    value={botForm.values.name}
                    onChange={(event) => botForm.setValue('name', event.target.value)}
                    onBlur={() => botForm.blur('name')}
                    aria-invalid={botNameError ? true : undefined}
                    aria-describedby={botNameError ? 'rule-bot-name-error' : undefined}
                    placeholder="FAQ bot"
                    maxLength={120}
                    className={INPUT}
                  />
                  <FieldError id="rule-bot-name-error" message={botNameError} />
                </label>
                <button
                  type="submit"
                  disabled={!botForm.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {botForm.isSubmitting
                    ? t('team.ruleBots.adding')
                    : t('team.ruleBots.addBotButton')}
                </button>
              </div>
              {botForm.submitError && (
                <p role="alert" className="text-2xs text-danger">
                  {botForm.submitError}
                </p>
              )}
            </form>
          )}

          {bots.isPending ? (
            <ListSkeleton rows={2} />
          ) : bots.data.items.length === 0 ? (
            <EmptyState
              title={t('team.ruleBots.empty.title')}
              description={t('team.ruleBots.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {bots.data.items.map((bot) => (
                <BotRow
                  key={bot.id}
                  bot={bot}
                  teams={teams.data?.items ?? []}
                  canEdit={canEdit}
                  onToggle={() => patchBot.mutate({ id: bot.id, enabled: !bot.enabled })}
                  onDelete={() => removeBot.mutate(bot.id)}
                  onSetGroups={(groups) => patchBot.mutateAsync({ id: bot.id, groups })}
                  onAddRule={(body) => createRule.mutateAsync({ botId: bot.id, ...body })}
                  onToggleRule={(rule) =>
                    patchRule.mutate({ botId: bot.id, ruleId: rule.id, enabled: !rule.enabled })
                  }
                  onDeleteRule={(rule) => removeRule.mutate({ botId: bot.id, ruleId: rule.id })}
                />
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

function BotRow({
  bot,
  teams,
  canEdit,
  onToggle,
  onDelete,
  onSetGroups,
  onAddRule,
  onToggleRule,
  onDeleteRule,
}: {
  bot: RuleBot;
  teams: Team[];
  canEdit: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onSetGroups: (groups: Array<{ group_id: number; priority: GroupPriority }>) => Promise<unknown>;
  onAddRule: (body: Record<string, unknown>) => Promise<unknown>;
  onToggleRule: (rule: RuleBotRule) => void;
  onDeleteRule: (rule: RuleBotRule) => void;
}): ReactElement {
  const t = useTranslate();
  const teamName = (id: number): string => teams.find((team) => team.id === id)?.name ?? String(id);

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-sm font-medium">{bot.name}</p>
        <StatusDot
          tone={bot.enabled ? 'success' : 'neutral'}
          label={bot.enabled ? t('team.ruleBots.on') : t('team.ruleBots.off')}
        />
        {canEdit && (
          <>
            <button type="button" onClick={onToggle} className={SMALL_BUTTON}>
              {bot.enabled ? t('team.ruleBots.disable') : t('team.ruleBots.enable')}
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label={t('team.ruleBots.deleteBotAriaLabel', { name: bot.name })}
              className={SMALL_BUTTON}
            >
              {t('team.ruleBots.delete')}
            </button>
          </>
        )}
      </div>

      <BotTeams
        bot={bot}
        teams={teams}
        canEdit={canEdit}
        teamName={teamName}
        onSetGroups={onSetGroups}
      />

      {bot.rules.length === 0 ? (
        <p className="text-2xs text-content-tertiary">{t('team.ruleBots.noRules')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {bot.rules.map((rule) => (
            <li key={rule.id} className="flex items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-2xs text-content-secondary">
                <span className="font-medium text-content-primary">{rule.name}</span>{' '}
                {describeRule(t, rule, teamName)}
              </span>
              <StatusDot
                tone={rule.enabled ? 'success' : 'neutral'}
                label={rule.enabled ? t('team.ruleBots.on') : t('team.ruleBots.off')}
              />
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => onToggleRule(rule)}
                    aria-label={t(
                      rule.enabled
                        ? 'team.ruleBots.disableRuleAriaLabel'
                        : 'team.ruleBots.enableRuleAriaLabel',
                      { name: rule.name },
                    )}
                    className={SMALL_BUTTON}
                  >
                    {rule.enabled ? t('team.ruleBots.disable') : t('team.ruleBots.enable')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteRule(rule)}
                    aria-label={t('team.ruleBots.deleteRuleAriaLabel', { name: rule.name })}
                    className={SMALL_BUTTON}
                  >
                    {t('team.ruleBots.delete')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && <RuleForm bot={bot} teams={teams} onAddRule={onAddRule} />}
    </li>
  );
}

/**
 * The teams a bot serves, and its priority in each — the KK's second half.
 *
 * Attaching replaces the whole list because that is what the endpoint takes: a
 * bot's teams are a set, and merging would leave no way to drop one. Re-adding a
 * team the bot already serves is therefore how its priority is changed, the same
 * upsert shape `TeamMembers.tsx` uses for an agent's.
 */
function BotTeams({
  bot,
  teams,
  canEdit,
  teamName,
  onSetGroups,
}: {
  bot: RuleBot;
  teams: Team[];
  canEdit: boolean;
  teamName: (id: number) => string;
  onSetGroups: (groups: Array<{ group_id: number; priority: GroupPriority }>) => Promise<unknown>;
}): ReactElement {
  const t = useTranslate();
  const [pickedTeam, setPickedTeam] = useState('');
  const [pickedPriority, setPickedPriority] = useState<GroupPriority>('normal');
  const [error, setError] = useState<string | null>(null);
  // Every write here sends the WHOLE list, built from the `bot` prop as it was
  // at click time. A second click before the first has come back would build
  // that list from stale data and silently drop the team just attached, so the
  // controls are held shut for the round trip rather than trusted to be slower
  // than a person.
  const [busy, setBusy] = useState(false);

  const setGroups = async (
    groups: Array<{ group_id: number; priority: GroupPriority }>,
  ): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await onSetGroups(groups);
    } catch (failure) {
      setError(t(errorMessageKey(failure)));
    } finally {
      setBusy(false);
    }
  };

  const attach = async (): Promise<void> => {
    const groupId = Number(pickedTeam);
    if (!pickedTeam) return;
    const others = bot.groups
      .filter((g) => g.group_id !== groupId)
      .map((g) => ({ group_id: g.group_id, priority: g.priority as GroupPriority }));
    await setGroups([...others, { group_id: groupId, priority: pickedPriority }]);
    setPickedTeam('');
  };

  return (
    <div className="flex flex-col gap-2">
      {bot.groups.length === 0 ? (
        <p className="text-2xs text-warning">{t('team.ruleBots.noTeams')}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {bot.groups.map((assignment) => (
            <li
              key={assignment.group_id}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-2xs"
            >
              <span>{teamName(assignment.group_id)}</span>
              <span className="text-content-tertiary">
                {t(`team.priority.${assignment.priority}`)}
              </span>
              {canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void setGroups(
                      bot.groups
                        .filter((g) => g.group_id !== assignment.group_id)
                        .map((g) => ({
                          group_id: g.group_id,
                          priority: g.priority as GroupPriority,
                        })),
                    )
                  }
                  aria-label={t('team.ruleBots.detachAriaLabel', {
                    team: teamName(assignment.group_id),
                    name: bot.name,
                  })}
                  className="text-content-tertiary transition-colors hover:text-danger disabled:opacity-40"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && teams.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pickedTeam}
            onChange={(event) => setPickedTeam(event.target.value)}
            aria-label={t('team.ruleBots.teamAriaLabel', { name: bot.name })}
            className={INPUT}
          >
            <option value="">{t('team.ruleBots.teamPlaceholder')}</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <select
            value={pickedPriority}
            onChange={(event) => setPickedPriority(event.target.value as GroupPriority)}
            aria-label={t('team.ruleBots.priorityAriaLabel', { name: bot.name })}
            className={INPUT}
          >
            {GROUP_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {t(`team.priority.${priority}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!pickedTeam || busy}
            onClick={() => void attach()}
            className={SMALL_BUTTON}
          >
            {t('team.ruleBots.attachButton')}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * "When … then …", one condition and one action.
 *
 * Deliberately one of each rather than an arbitrary predicate builder: a rule
 * with three conditions is an AND the server supports and the API can express,
 * but a form that offers it invites people to write rules they cannot read back.
 * Two rules are clearer than one complicated one, and the list above shows them
 * in the order they are tried.
 */
function RuleForm({
  bot,
  teams,
  onAddRule,
}: {
  bot: RuleBot;
  teams: Team[];
  onAddRule: (body: Record<string, unknown>) => Promise<unknown>;
}): ReactElement {
  const t = useTranslate();
  const [conditionKind, setConditionKind] = useState<ConditionKind>('message_word');
  const [actionKind, setActionKind] = useState<ActionKind>('send_message');

  const form = useForm({
    initial: { name: '', when: '', then: '' },
    validators: {
      name: required(t('team.ruleBots.ruleNameError')),
      when: required(t('team.ruleBots.whenError')),
      then: required(t('team.ruleBots.thenError')),
    },
    onSubmit: async (values, { reset, setSubmitError }) => {
      const actions =
        actionKind === 'transfer_to_group_id'
          ? { transfer_to_group_id: Number(values.then) }
          : { [actionKind]: values.then.trim() };
      try {
        await onAddRule({
          name: values.name.trim(),
          conditions: { [conditionKind]: values.when.trim() },
          actions,
          // Appended to the end of the bot's list, so a new rule never silently
          // overtakes one that is already answering.
          position: bot.rules.length,
        });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const nameError = form.errorFor('name');
  const whenError = form.errorFor('when');
  const thenError = form.errorFor('then');
  const isTransfer = actionKind === 'transfer_to_group_id';

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex w-36 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.ruleBots.ruleNameLabel')}
          </span>
          <input
            value={form.values.name}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.blur('name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `rule-name-error-${bot.id}` : undefined}
            placeholder="Opening hours"
            maxLength={120}
            className={INPUT}
          />
          <FieldError id={`rule-name-error-${bot.id}`} message={nameError} />
        </label>

        <label className="flex w-40 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.ruleBots.whenLabel')}
          </span>
          <select
            value={conditionKind}
            onChange={(event) => setConditionKind(event.target.value as ConditionKind)}
            aria-label={t('team.ruleBots.conditionKindAriaLabel', { name: bot.name })}
            className={INPUT}
          >
            {CONDITION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`team.ruleBots.condition.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-40 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.ruleBots.whenValueLabel')}
          </span>
          <input
            value={form.values.when}
            onChange={(event) => form.setValue('when', event.target.value)}
            onBlur={() => form.blur('when')}
            aria-invalid={whenError ? true : undefined}
            aria-describedby={whenError ? `rule-when-error-${bot.id}` : undefined}
            placeholder="hours"
            maxLength={2048}
            className={INPUT}
          />
          <FieldError id={`rule-when-error-${bot.id}`} message={whenError} />
        </label>

        <label className="flex w-40 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.ruleBots.thenLabel')}
          </span>
          <select
            value={actionKind}
            onChange={(event) => {
              // Switching action kind changes what the value means, so clear it
              // rather than carry a message into a team picker.
              setActionKind(event.target.value as ActionKind);
              form.setValue('then', '');
            }}
            aria-label={t('team.ruleBots.actionKindAriaLabel', { name: bot.name })}
            className={INPUT}
          >
            {ACTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`team.ruleBots.action.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex w-48 flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('team.ruleBots.thenValueLabel')}
          </span>
          {isTransfer ? (
            <select
              value={form.values.then}
              onChange={(event) => form.setValue('then', event.target.value)}
              onBlur={() => form.blur('then')}
              aria-invalid={thenError ? true : undefined}
              aria-describedby={thenError ? `rule-then-error-${bot.id}` : undefined}
              className={INPUT}
            >
              <option value="">{t('team.ruleBots.teamPlaceholder')}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={form.values.then}
              onChange={(event) => form.setValue('then', event.target.value)}
              onBlur={() => form.blur('then')}
              aria-invalid={thenError ? true : undefined}
              aria-describedby={thenError ? `rule-then-error-${bot.id}` : undefined}
              placeholder="We are open 09:00-18:00."
              maxLength={2000}
              className={INPUT}
            />
          )}
          <FieldError id={`rule-then-error-${bot.id}`} message={thenError} />
        </label>

        <button type="submit" disabled={!form.canSubmit} className={SMALL_BUTTON}>
          {form.isSubmitting ? t('team.ruleBots.adding') : t('team.ruleBots.addRuleButton')}
        </button>
      </div>

      {form.submitError && (
        <p role="alert" className="text-2xs text-danger">
          {form.submitError}
        </p>
      )}
    </form>
  );
}

/** One readable "when … → then …" line, the shape the ticket-rule list uses. */
function describeRule(t: TFunction, rule: RuleBotRule, teamName: (id: number) => string): string {
  const when: string[] = [];
  for (const kind of CONDITION_KINDS) {
    const value = rule.conditions[kind];
    if (value) when.push(t(`team.ruleBots.describe.${kind}`, { value }));
  }
  if (rule.conditions.office_hours) {
    when.push(t(`team.ruleBots.describe.office_hours.${rule.conditions.office_hours}`));
  }

  const then: string[] = [];
  if (rule.actions.send_message)
    then.push(t('team.ruleBots.describe.send_message', { value: rule.actions.send_message }));
  if (rule.actions.add_tag)
    then.push(t('team.ruleBots.describe.add_tag', { value: rule.actions.add_tag }));
  if (rule.actions.transfer_to_group_id != null)
    then.push(
      t('team.ruleBots.describe.transfer_to_group_id', {
        value: teamName(rule.actions.transfer_to_group_id),
      }),
    );

  return `${when.join(t('team.ruleBots.andJoiner'))} → ${then.join(', ')}`;
}
