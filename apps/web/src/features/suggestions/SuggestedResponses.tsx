/**
 * Settings → Saved replies → "Suggested replies" (IN-07 · tm 364).
 *
 * Binds saved replies to the things that happen in a conversation — it starts, it
 * is handed to the agent, the player goes quiet, the player rates it — so the
 * composer offers them as chips at that moment. A chip only fills the reply box;
 * nothing is ever sent for the agent.
 *
 * Lives beside `CannedResponses.tsx` (it is a part of that screen, drawn under the
 * list) but in its own folder: `settings/*.tsx` files are each a navigation
 * section, and this is not one. It writes the same rows through the same
 * endpoint, so the writer is whoever may already write that reply — a curator for
 * a shared one, its author for a personal one — and the reader's `#` picker and
 * chips refresh from the same cache key.
 *
 * Also here: how long a quiet player takes to count as idle (`customer_idle_seconds`,
 * the workspace's inbox setting, an administrator's to change).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import {
  CANNED_CATEGORIES,
  CUSTOMER_IDLE_MAX_SECONDS,
  CUSTOMER_IDLE_MIN_SECONDS,
  DEFAULT_CUSTOMER_IDLE_SECONDS,
  SUGGEST_EVENTS,
  SUGGEST_ORDER_MAX,
  type CannedCategory,
  type SuggestEvent,
} from '@siyahtus/types';
import { Card } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';

/** The part of a saved reply this screen reads and writes. */
export interface SuggestableReply {
  id: string;
  shortcut: string;
  text: string;
  visibility: 'all' | 'group' | 'private';
  suggest_on?: SuggestEvent[];
  suggest_order?: number;
  category?: CannedCategory;
}

interface ChatTimeoutRead {
  chat_timeout_seconds: number | null;
  customer_idle_seconds?: number | null;
}

export function SuggestedResponses({
  items,
  canEdit,
  canWritePersonal,
  canConfigureIdle,
}: {
  items: readonly SuggestableReply[];
  /** May change shared replies (`canned_responses--all:rw`). */
  canEdit: boolean;
  /** May change their own personal replies. */
  canWritePersonal: boolean;
  /** May change the workspace's inbox settings (`access_rules:rw`). */
  canConfigureIdle: boolean;
}): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  // Folded away until asked for: the rows repeat every shortcut already listed
  // above, and a screen that shows each one twice is harder to read and to drive.
  const [open, setOpen] = useState(false);

  const writable = items.filter((item) =>
    item.visibility === 'private' ? canWritePersonal : canEdit,
  );

  const patch = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { suggest_on?: SuggestEvent[]; suggest_order?: number; category?: CannedCategory };
    }) => api.patch(`/settings/canned-responses/${id}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'canned-responses'] });
      // The composer reads the same replies, and its chips with them.
      void queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
    },
  });

  async function save(
    id: string,
    body: { suggest_on?: SuggestEvent[]; suggest_order?: number; category?: CannedCategory },
  ): Promise<void> {
    try {
      await patch.mutateAsync({ id, body });
      setError(null);
    } catch (caught) {
      setError(t(errorMessageKey(caught)));
    }
  }

  if (writable.length === 0 && !canConfigureIdle) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t('settings.suggestedReplies.title')}</h3>
          <p className="text-2xs text-content-tertiary">
            {t('settings.suggestedReplies.description')}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="suggested-replies-body"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {open ? t('settings.suggestedReplies.hide') : t('settings.suggestedReplies.show')}
        </button>
      </div>

      {open && (
        <div id="suggested-replies-body" className="border-t border-border">
          {canConfigureIdle && <IdleSeconds />}

          {error && (
            <p role="alert" className="border-b border-border px-4 py-2 text-2xs text-danger">
              {error}
            </p>
          )}

          {writable.length === 0 ? (
            <p className="px-4 py-3 text-sm text-content-secondary">
              {t('settings.suggestedReplies.empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {writable.map((item) => (
                <SuggestRow key={item.id} item={item} onSave={save} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

function SuggestRow({
  item,
  onSave,
}: {
  item: SuggestableReply;
  onSave: (
    id: string,
    body: { suggest_on?: SuggestEvent[]; suggest_order?: number; category?: CannedCategory },
  ) => Promise<void>;
}): ReactElement {
  const t = useTranslate();
  const on = item.suggest_on ?? [];
  const [order, setOrder] = useState(String(item.suggest_order ?? 0));
  useEffect(() => setOrder(String(item.suggest_order ?? 0)), [item.suggest_order]);

  function toggle(event: SuggestEvent): void {
    const next = on.includes(event) ? on.filter((e) => e !== event) : [...on, event];
    void onSave(item.id, { suggest_on: SUGGEST_EVENTS.filter((e) => next.includes(e)) });
  }

  function commitOrder(): void {
    const value = Number(order);
    if (!Number.isInteger(value) || value < 0 || value > SUGGEST_ORDER_MAX) {
      setOrder(String(item.suggest_order ?? 0));
      return;
    }
    if (value !== (item.suggest_order ?? 0)) void onSave(item.id, { suggest_order: value });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-2.5" data-testid={`suggest-row-${item.shortcut}`}>
      <div className="flex items-start gap-3">
        {/* The reply's words are in the list above; repeating them here would give
            every row two identical texts on one screen, so they ride on the title. */}
        <code
          title={item.text}
          className="mt-0.5 shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-2xs"
        >
          #{item.shortcut}
        </code>
      </div>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <legend className="sr-only">
          {t('settings.suggestedReplies.eventsLegend', { shortcut: item.shortcut })}
        </legend>
        {SUGGEST_EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-1.5 text-xs text-content-secondary">
            <input
              type="checkbox"
              checked={on.includes(event)}
              onChange={() => toggle(event)}
              aria-label={t('settings.suggestedReplies.eventAria', {
                shortcut: item.shortcut,
                event: t(`settings.suggestedReplies.event.${event}`),
              })}
            />
            {t(`settings.suggestedReplies.event.${event}`)}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-2xs text-content-tertiary">
          {t('settings.suggestedReplies.orderLabel')}
          <input
            type="number"
            min={0}
            max={SUGGEST_ORDER_MAX}
            value={order}
            onChange={(event) => setOrder(event.target.value)}
            onBlur={commitOrder}
            aria-label={t('settings.suggestedReplies.orderAria', { shortcut: item.shortcut })}
            className="w-24 rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-2xs text-content-tertiary">
          {t('settings.suggestedReplies.categoryLabel')}
          <select
            value={item.category ?? 'general'}
            onChange={(event) =>
              void onSave(item.id, { category: event.target.value as CannedCategory })
            }
            aria-label={t('settings.suggestedReplies.categoryAria', { shortcut: item.shortcut })}
            className="rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none"
          >
            {CANNED_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`settings.suggestedReplies.category.${category}`)}
              </option>
            ))}
          </select>
        </label>
        {(item.category ?? 'general') === 'promotion' && (
          <span className="pb-1 text-2xs text-content-tertiary">
            {t('settings.suggestedReplies.promotionHint')}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * How long the player may stay silent after the agent's message before the
 * "went quiet" chips appear. Shares the chat-timeout cache with its own screen,
 * so a save here and a save there never disagree.
 */
function IdleSeconds(): ReactElement | null {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings', 'chat-timeout'],
    queryFn: () => api.get<ChatTimeoutRead>('/settings/chat-timeout'),
  });
  const stored = settings.data?.customer_idle_seconds ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    // `chat_timeout_seconds` is required by the endpoint; echoing the stored one
    // changes nothing, and every other setting is left out so it keeps its value.
    mutationFn: (seconds: number | null) =>
      api.put<ChatTimeoutRead>('/settings/chat-timeout', {
        chat_timeout_seconds: settings.data?.chat_timeout_seconds ?? null,
        customer_idle_seconds: seconds,
      }),
    onSuccess: (data) => queryClient.setQueryData(['settings', 'chat-timeout'], data),
  });

  if (settings.isPending || settings.error) return null;

  const shown = draft ?? String(stored ?? DEFAULT_CUSTOMER_IDLE_SECONDS);

  async function submit(): Promise<void> {
    const text = draft?.trim() ?? '';
    const value = Number(text);
    if (
      text === '' ||
      !Number.isInteger(value) ||
      value < CUSTOMER_IDLE_MIN_SECONDS ||
      value > CUSTOMER_IDLE_MAX_SECONDS
    ) {
      setError(
        t('settings.suggestedReplies.idleInvalid', {
          min: CUSTOMER_IDLE_MIN_SECONDS,
          max: CUSTOMER_IDLE_MAX_SECONDS,
        }),
      );
      return;
    }
    try {
      await save.mutateAsync(value === DEFAULT_CUSTOMER_IDLE_SECONDS ? null : value);
      setDraft(null);
      setError(null);
    } catch (caught) {
      setError(t(errorMessageKey(caught)));
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-border px-4 py-3">
      <label htmlFor="customer-idle-seconds" className="flex w-60 flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('settings.suggestedReplies.idleLabel')}
        </span>
        <input
          id="customer-idle-seconds"
          type="number"
          min={CUSTOMER_IDLE_MIN_SECONDS}
          max={CUSTOMER_IDLE_MAX_SECONDS}
          value={shown}
          onChange={(event) => setDraft(event.target.value)}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={draft === null || save.isPending}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {save.isPending ? t('settings.saving') : t('settings.save')}
      </button>
      <span className="w-full text-2xs text-content-tertiary">
        {t('settings.suggestedReplies.idleHint', { seconds: DEFAULT_CUSTOMER_IDLE_SECONDS })}
      </span>
      {error && (
        <p role="alert" className="w-full text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
