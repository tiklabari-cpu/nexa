/**
 * "Talk like a player" (tm 314.5 · AI-19 §8): a conversation with the AI on the
 * same engine turn customers get (`POST /ai/sandbox-sessions/{id}/turns`), with
 * every reply's decision trace beside it — the procedure and why, what it
 * collected, the knowledge it used (source and page), the guardrails that
 * fired, the hand-over and its reason, the flags, the tokens. Nothing is
 * written to a conversation; the turns count on the test meter, not the live one.
 *
 * The session lives 24 hours past its last turn and is its starter's alone;
 * the tab remembers it for this browser session and picks it up again
 * (`GET …/{id}`) — a 404 there just means a new one. "Save as scenario" turns
 * the player's lines into a scripted scenario with expectations suggested from
 * how it went, to be edited before it is trusted.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  AI_TEST_SCENARIO_NAME_MAX,
  AI_TEST_TURN_TEXT_MAX,
  type AiTestTranscriptEntry,
  type AiTestTurnTrace,
} from '@siyahtus/types';
import { Card } from '../../components/Page.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import type { SandboxSession, SandboxTurn, TestScenario } from './ai-testing.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';
const input = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm';

type Target = 'draft' | 'published';

/** Where this browser session keeps the agent's open sandbox. */
export function sandboxStorageKey(agentId: string): string {
  return `siyahtus.ai-sandbox.${agentId}`;
}

function storedSessionId(agentId: string): string | null {
  try {
    return window.sessionStorage.getItem(sandboxStorageKey(agentId));
  } catch {
    return null;
  }
}

function storeSessionId(agentId: string, id: string | null): void {
  try {
    if (id) window.sessionStorage.setItem(sandboxStorageKey(agentId), id);
    else window.sessionStorage.removeItem(sandboxStorageKey(agentId));
  } catch {
    // Storage refused (private mode): the session simply is not picked up again.
  }
}

export function SandboxChat({
  agentId,
  canEdit,
  onClose,
  onSavedScenario,
}: {
  agentId: string;
  canEdit: boolean;
  onClose: () => void;
  onSavedScenario: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [resumeId] = useState(() => storedSessionId(agentId));
  const [session, setSession] = useState<SandboxSession | null>(null);
  const [target, setTarget] = useState<Target>('draft');
  const [message, setMessage] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [saved, setSaved] = useState<TestScenario | null>(null);

  const resumed = useQuery({
    queryKey: ['playbook', 'ai-testing', 'sandbox', resumeId],
    queryFn: () => api.get<SandboxSession>(`/ai/sandbox-sessions/${resumeId}`),
    enabled: resumeId !== null,
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (resumed.data && session === null) setSession(resumed.data);
    // Expired, or someone else's: forget it and start fresh.
    if (resumed.error instanceof ApiClientError && resumed.error.status === 404) {
      storeSessionId(agentId, null);
    }
  }, [resumed.data, resumed.error, session, agentId]);

  const start = useMutation({
    mutationFn: () =>
      api.post<SandboxSession>('/ai/sandbox-sessions', { ai_agent_id: agentId, target }),
    onSuccess: (created) => {
      storeSessionId(agentId, created.id);
      setSession(created);
      setSaved(null);
    },
  });

  const send = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.post<SandboxTurn>(`/ai/sandbox-sessions/${id}/turns`, { message: text }),
    onSuccess: (turn) => {
      setSession(turn.session);
      setMessage('');
    },
  });

  const save = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.post<TestScenario>(`/ai/sandbox-sessions/${id}/save-as-scenario`, { name }),
    onSuccess: (scenario) => {
      setSaved(scenario);
      setScenarioName('');
      onSavedScenario();
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (!session || text === '' || send.isPending) return;
    send.mutate({ id: session.id, text });
  };

  const playerLines = session?.transcript.filter((entry) => entry.role === 'player').length ?? 0;

  return (
    <section
      aria-label={t('playbook.test.sandbox.title')}
      data-testid="sandbox-chat"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{t('playbook.test.sandbox.title')}</h2>
          <p className="mt-0.5 text-2xs text-content-tertiary">
            {t('playbook.test.sandbox.description')}
          </p>
        </div>
        <button type="button" className={button} onClick={onClose}>
          {t('playbook.test.actions.back')}
        </button>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <label className="flex items-center gap-2 text-xs text-content-secondary">
            {t('playbook.test.run.target')}
            <select
              value={target}
              onChange={(event) => setTarget(event.target.value as Target)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs"
            >
              <option value="draft">{t('playbook.test.target.draft')}</option>
              <option value="published">{t('playbook.test.target.published')}</option>
            </select>
          </label>
          <button
            type="button"
            className={button}
            disabled={!canEdit || start.isPending}
            onClick={() => start.mutate()}
          >
            {session ? t('playbook.test.sandbox.restart') : t('playbook.test.sandbox.start')}
          </button>
          {session && (
            <span className="text-2xs text-content-tertiary">
              {t(`playbook.test.target.${session.target}`)} ·{' '}
              {t('playbook.test.results.tokens', { count: session.tokens })}
            </span>
          )}
        </div>
        {start.isError && (
          <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-danger">
            {t(errorMessageKey(start.error))}
          </p>
        )}
      </Card>

      {session && (
        <>
          <Card>
            <div className="flex flex-col gap-3 p-4">
              {session.transcript.length === 0 ? (
                <p className="text-2xs text-content-tertiary">{t('playbook.test.sandbox.empty')}</p>
              ) : (
                <Transcript entries={session.transcript} />
              )}
              {canEdit && (
                <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
                  <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                    {t('playbook.test.sandbox.message')}
                    <textarea
                      value={message}
                      maxLength={AI_TEST_TURN_TEXT_MAX}
                      rows={2}
                      onChange={(event) => setMessage(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                      className={input}
                    />
                  </label>
                  <button
                    type="submit"
                    className={primaryButton}
                    disabled={send.isPending || message.trim() === ''}
                  >
                    {send.isPending
                      ? t('playbook.test.sandbox.sending')
                      : t('playbook.test.sandbox.send')}
                  </button>
                </form>
              )}
              {send.isError && (
                <p role="alert" className="text-2xs text-danger">
                  {t(errorMessageKey(send.error))}
                </p>
              )}
            </div>
          </Card>

          {canEdit && playerLines > 0 && (
            <Card>
              <form
                className="flex flex-wrap items-end gap-2 p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = scenarioName.trim();
                  if (name !== '') save.mutate({ id: session.id, name });
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                  {t('playbook.test.sandbox.scenarioName')}
                  <input
                    value={scenarioName}
                    maxLength={AI_TEST_SCENARIO_NAME_MAX}
                    onChange={(event) => setScenarioName(event.target.value)}
                    className={input}
                  />
                </label>
                <button
                  type="submit"
                  className={button}
                  disabled={save.isPending || scenarioName.trim() === ''}
                >
                  {t('playbook.test.sandbox.saveAsScenario')}
                </button>
              </form>
              <p className="border-t border-border px-4 py-2 text-2xs text-content-tertiary">
                {t('playbook.test.sandbox.saveHint')}
              </p>
              {saved && (
                <p role="status" className="border-t border-border px-4 py-2 text-2xs text-success">
                  {t('playbook.test.sandbox.saved', { name: saved.name })}
                </p>
              )}
              {save.isError && (
                <p role="alert" className="border-t border-border px-4 py-2 text-2xs text-danger">
                  {t(errorMessageKey(save.error))}
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </section>
  );
}

/** A played conversation: the player's lines, the AI's, and each AI turn's trace. */
export function Transcript({
  entries,
}: {
  entries: readonly AiTestTranscriptEntry[];
}): ReactElement {
  const t = useTranslate();
  return (
    <ol aria-label={t('playbook.test.transcript.label')} className="flex flex-col gap-2">
      {entries.map((entry, index) => (
        <li
          key={`${entry.at}-${index}`}
          className={`flex flex-col gap-1 ${entry.role === 'player' ? 'items-end' : 'items-start'}`}
        >
          <span className="text-2xs text-content-tertiary">
            {t(`playbook.test.transcript.role.${entry.role}`)}
          </span>
          <p
            className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              entry.role === 'player' ? 'bg-brand-500 text-white' : 'bg-surface-2'
            }`}
          >
            {entry.text === '' ? t('playbook.test.transcript.noText') : entry.text}
          </p>
          {entry.trace && <DecisionTrace trace={entry.trace} />}
        </li>
      ))}
    </ol>
  );
}

/** Why the AI said what it said on one turn (AI-19 §8 "karar izi"). */
export function DecisionTrace({ trace }: { trace: AiTestTurnTrace }): ReactElement {
  const t = useTranslate();
  const slots = Object.entries(trace.slots);
  const none = t('playbook.test.trace.none');
  const rows: Array<[string, string]> = [
    [t('playbook.test.trace.decision'), t(`playbook.test.decision.${trace.decision}`)],
    [
      t('playbook.test.trace.procedure'),
      trace.procedure
        ? t('playbook.test.trace.procedureWhy', {
            name: trace.procedure.name,
            reason: trace.procedure.reason,
          })
        : none,
    ],
    [
      t('playbook.test.trace.collected'),
      slots.length > 0 ? slots.map(([key, value]) => `${key}: ${value}`).join(' · ') : none,
    ],
    [
      t('playbook.test.trace.sources'),
      trace.sources.length > 0
        ? trace.sources
            .map((source) =>
              source.page !== null
                ? t('playbook.test.trace.sourcePage', { title: source.title, page: source.page })
                : source.title,
            )
            .join(' · ')
        : none,
    ],
    [
      t('playbook.test.trace.guardrails'),
      trace.guardrails.length > 0
        ? trace.guardrails.map((hit) => `${hit.rule_key} (${hit.action})`).join(' · ')
        : none,
    ],
    [
      t('playbook.test.trace.handoff'),
      trace.handoff
        ? [
            trace.handoff.reason,
            trace.handoff.topic ? t(`team.queue.role.${trace.handoff.topic}`) : null,
            trace.handoff.team_id !== null
              ? t('playbook.test.results.team', { id: trace.handoff.team_id })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : none,
    ],
    [
      t('playbook.test.trace.flags'),
      trace.flags.length > 0
        ? trace.flags.map((flag) => t(`inbox.risk.type.${flag}`)).join(' · ')
        : none,
    ],
    [t('playbook.test.trace.tokens'), String(trace.tokens)],
  ];
  return (
    <dl
      aria-label={t('playbook.test.trace.label')}
      data-testid="decision-trace"
      className="grid max-w-[80%] grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border border-border px-3 py-2 text-2xs"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-content-tertiary">{label}</dt>
          <dd className="text-content-secondary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
