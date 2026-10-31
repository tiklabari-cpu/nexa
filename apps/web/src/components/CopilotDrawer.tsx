/**
 * The Copilot drawer (IN-09): ask a question from any screen.
 *
 * Mounted by the shell beside `<main>`, so it is there on Reports, Settings and
 * the archive as much as in the inbox, and it is still there — with the
 * conversation in it — after the agent navigates. It is a side panel, not a
 * modal: the page stays usable and shortcut keys keep working (a modal would
 * mute them, `aria-modal`). Alt+Shift+C opens and closes it; Esc closes it from
 * inside; closing hands focus back to where it came from.
 *
 * One box takes any question. Copilot tells a report question from a knowledge
 * question on the server (`POST /copilot/ask`), so the drawer never asks the
 * agent which kind they meant. Beside an open conversation it also offers the
 * two chat assists and lets an answer be handed to the reply composer; nothing
 * reaches a player on its own (`offerDraft`).
 *
 * The history lives in `copilotDrawerStore`, in memory: it survives navigation
 * and is gone on reload.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { BI_EXAMPLE_QUESTIONS } from '../features/copilot/biQuestions.js';
import { useCopilotDrawerStore, type DrawerEntry } from '../features/copilot/copilotDrawerStore.js';
import { ASK_MAX_CHARS, useCopilotDrawerActions } from '../features/copilot/useCopilotDrawer.js';
import { offerDraft } from '../features/inbox/copilotDraft.js';
import { AI_DAILY_CAP_MESSAGE_KEY } from '../lib/api-client.js';
import { formatDate } from '../lib/format.js';
import { useTranslate } from '../lib/i18n.js';
import { COPILOT_FIELD_ATTRIBUTE } from '../lib/shortcuts.js';
import { Skeleton } from './Skeleton.js';
import { Panel } from './ui/index.js';

export function CopilotDrawer(): ReactElement | null {
  const open = useCopilotDrawerStore((s) => s.open);
  return open ? <OpenDrawer /> : null;
}

function OpenDrawer(): ReactElement {
  const t = useTranslate();
  const entries = useCopilotDrawerStore((s) => s.entries);
  const chat = useCopilotDrawerStore((s) => s.chat);
  const setOpen = useCopilotDrawerStore((s) => s.setOpen);
  const clear = useCopilotDrawerStore((s) => s.clear);
  const { ask, summarise, draft } = useCopilotDrawerActions();
  const [question, setQuestion] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  // Focus: in on open, back to where it came from on close. The element that
  // had focus when the drawer opened is the one that gets it back, if it is
  // still on the page.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    field.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  // A new answer scrolls into view; the log is its own scroll area.
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const busy = entries.some((entry) => entry.status === 'pending');

  const submit = (event?: FormEvent): void => {
    event?.preventDefault();
    const text = question.trim();
    if (!text) return;
    setQuestion('');
    void ask(text);
  };

  return (
    <Panel
      label={t('shell.copilot.drawer.label')}
      title={
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true">✧</span> {t('shell.copilot.drawer.title')}
        </span>
      }
      className="w-details shrink-0 border-l border-border"
      onCollapse={() => setOpen(false)}
      collapseLabel={t('shell.copilot.drawer.close')}
      headerAction={
        entries.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-border px-2 py-0.5 text-2xs font-medium text-content-secondary hover:bg-surface-2"
          >
            {t('shell.copilot.drawer.clear')}
          </button>
        ) : undefined
      }
    >
      {/* Esc closes from anywhere inside the drawer, the way it closes a menu. */}
      <div
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {chat && (
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={() => void summarise()}
              disabled={busy}
              className="rounded-md border border-border px-2.5 py-1 text-2xs hover:bg-surface-2 disabled:opacity-50"
            >
              {t('shell.copilot.drawer.summarise')}
            </button>
            <button
              type="button"
              onClick={() => void draft()}
              disabled={busy || !chat.canDraft}
              className="rounded-md border border-border px-2.5 py-1 text-2xs hover:bg-surface-2 disabled:opacity-50"
            >
              {t('shell.copilot.drawer.draft')}
            </button>
          </div>
        )}

        <div
          ref={log}
          role="log"
          aria-label={t('shell.copilot.drawer.history')}
          aria-live="polite"
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
        >
          {entries.length === 0 ? (
            <Intro onPick={setQuestion} />
          ) : (
            entries.map((entry) => <Entry key={entry.id} entry={entry} onPick={setQuestion} />)
          )}
        </div>

        <form onSubmit={submit} className="flex flex-col gap-1.5 border-t border-border p-3">
          <label className="sr-only" htmlFor="copilot-drawer-question">
            {t('shell.copilot.drawer.question')}
          </label>
          <textarea
            id="copilot-drawer-question"
            ref={field}
            {...{ [COPILOT_FIELD_ATTRIBUTE]: 'copilot' }}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter makes a new line. An input method that
              // is still composing (Turkish, CJK) uses Enter to confirm a word.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={ASK_MAX_CHARS}
            placeholder={t('shell.copilot.drawer.placeholder')}
            className="w-full resize-none rounded-md border border-border bg-inset px-2 py-1.5 text-xs outline-none placeholder:text-content-tertiary"
          />
          <button
            type="submit"
            disabled={!question.trim()}
            className="self-end rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {t('shell.copilot.drawer.ask')}
          </button>
        </form>
      </div>
    </Panel>
  );
}

/** Before the first question: what it can answer, with examples that fill the box. */
function Intro({ onPick }: { onPick: (question: string) => void }): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-2 text-xs text-content-secondary">
      <p>{t('shell.copilot.drawer.intro')}</p>
      <div className="flex flex-col gap-1">
        {BI_EXAMPLE_QUESTIONS.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="rounded-md border border-border px-2.5 py-1.5 text-left text-2xs hover:bg-surface-2"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

function Entry({
  entry,
  onPick,
}: {
  entry: DrawerEntry;
  onPick: (question: string) => void;
}): ReactElement {
  const t = useTranslate();
  const chat = useCopilotDrawerStore((s) => s.chat);
  const heading =
    entry.kind === 'summary'
      ? t('shell.copilot.drawer.summarise')
      : entry.kind === 'draft'
        ? t('shell.copilot.drawer.draft')
        : entry.question;
  // A draft goes to the composer of the conversation it was asked about, and
  // only while that conversation is the open one and can still be answered.
  const canInsert = chat !== null && chat.id === entry.chatId && chat.canDraft;

  return (
    <article className="flex flex-col gap-1.5" data-copilot-entry={entry.kind}>
      <p className="self-end rounded-md bg-surface-2 px-2.5 py-1.5 text-xs">{heading}</p>
      <EntryAnswer entry={entry} canInsert={canInsert} onPick={onPick} />
    </article>
  );
}

function EntryAnswer({
  entry,
  canInsert,
  onPick,
}: {
  entry: DrawerEntry;
  canInsert: boolean;
  onPick: (question: string) => void;
}): ReactElement {
  const t = useTranslate();

  if (entry.status === 'pending') {
    return (
      <div aria-hidden="true" className="flex flex-col gap-2 rounded-md bg-inset p-2">
        <Skeleton width="55%" />
        <Skeleton width="90%" />
      </div>
    );
  }

  if (entry.status === 'error') {
    return (
      <p role="alert" className="text-2xs text-danger">
        {t(
          entry.error === 'ai_daily_cap' ? AI_DAILY_CAP_MESSAGE_KEY : 'shell.copilot.drawer.error',
        )}
      </p>
    );
  }

  // A question Copilot may not answer, or has no answer to: told in the
  // console's words, not the server's — the reason is a code, the sentence is ours.
  if (entry.reason === 'not_permitted') {
    return <Note>{t('shell.copilot.drawer.notPermitted')}</Note>;
  }
  if (entry.reason === 'no_answer' || entry.answerKind === 'unknown') {
    return <Note>{t('shell.copilot.drawer.noAnswer')}</Note>;
  }
  if (entry.reason === 'not_understood') {
    return (
      <div className="flex flex-col gap-1.5 rounded-md bg-inset p-2 text-xs">
        <p className="font-medium">{t('shell.copilot.drawer.notUnderstood')}</p>
        <p className="text-content-secondary">{entry.answer}</p>
        <div className="flex flex-col gap-1">
          {BI_EXAMPLE_QUESTIONS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onPick(example)}
              className="rounded-md border border-border px-2.5 py-1.5 text-left text-2xs text-content-secondary hover:bg-surface-2"
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const sources = entry.sources ?? [];
  const insertable = entry.answer && (entry.kind === 'draft' || entry.answerKind === 'kb');

  return (
    <div className="flex flex-col gap-2 rounded-md bg-inset p-2 text-xs">
      <p className="whitespace-pre-wrap text-content-secondary">{entry.answer}</p>
      {entry.kind === 'summary' && (
        <p className={`text-2xs ${entry.noteSaved ? 'text-success' : 'text-content-tertiary'}`}>
          {t(
            entry.noteSaved ? 'inbox.copilot.summary.noteAdded' : 'inbox.copilot.summary.notSaved',
          )}
        </p>
      )}
      {sources.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xs font-semibold uppercase tracking-wide text-content-tertiary">
            {t('shell.copilot.drawer.sources')}
          </p>
          <ul className="flex flex-col gap-0.5">
            {sources.map((source) => (
              <li key={source.id} className="text-2xs text-content-tertiary">
                <span className="font-medium text-content-secondary">{source.title}</span>
                {' · '}
                {t('shell.copilot.drawer.reviewed', {
                  date: formatDate(source.reviewed_at) ?? '—',
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {insertable && canInsert && entry.chatId && (
        <button
          type="button"
          onClick={() => offerDraft(entry.chatId!, entry.answer!)}
          className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white hover:bg-brand-600"
        >
          {t('inbox.copilot.insert')}
        </button>
      )}
    </div>
  );
}

function Note({ children }: { children: string }): ReactElement {
  return <p className="rounded-md bg-inset p-2 text-xs text-content-secondary">{children}</p>;
}
