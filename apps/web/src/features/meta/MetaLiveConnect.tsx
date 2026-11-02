/**
 * "Connect with Facebook" — the live Messenger / Instagram card's connect step
 * (tm 381 · KN-02).
 *
 * One click opens Facebook Login in a pop-up (`meta-login.ts`). When the
 * callback page relays the code, the card asks the API for the pages that
 * login opened (`POST /channels/meta/pages` — names and linked Instagram
 * accounts, no token) and the admin picks one; the choice goes to
 * `POST /channels/{type}/connect` as `{ selection_id, page_id }`. Instagram
 * lists only pages with a linked professional account, and says so when
 * there is none. Closing the pop-up early, a blocked pop-up and every refusal
 * the API gives are said in the card, in the console's language.
 *
 * The same control reconnects a channel Meta stopped accepting (Graph error
 * 190): a fresh login is the only way to a fresh page token.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { liveConnectErrorText } from '../apps/live-errors.js';
import {
  connectablePages,
  loginDialogUrl,
  newLoginState,
  readMetaCallback,
  type MetaLoginConfig,
  type MetaMessagingChannel,
  type MetaPageChoice,
  type MetaPageSelection,
} from './meta-login.js';

/** How long after the pop-up closes a late message is still waited for. */
const CLOSE_GRACE_MS = 1500;

type Phase = 'idle' | 'waiting' | 'loading' | 'choosing' | 'connecting';

const NAME: Record<MetaMessagingChannel, string> = {
  messenger: 'Messenger',
  instagram: 'Instagram',
};

function pageLabel(page: MetaPageChoice, channel: MetaMessagingChannel): string {
  if (channel === 'instagram' && page.instagram) {
    return page.instagram.username ? `@${page.instagram.username} · ${page.name}` : page.name;
  }
  return page.name;
}

export function MetaLiveConnect({
  channel,
  label,
}: {
  channel: MetaMessagingChannel;
  label: string;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const groupId = useId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<MetaPageSelection | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const connect = useMutation({
    mutationFn: (body: { selection_id: string; page_id: string }) =>
      api.post(`/channels/${channel}/connect`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const failureText = (failure: unknown): string => {
    const reason = failure instanceof ApiClientError ? failure.details?.['reason'] : undefined;
    if (reason === 'meta_selection_invalid') return t('settings.channels.meta.selectionExpired');
    if (reason === 'instagram_account_not_linked') return t('settings.channels.meta.noInstagram');
    return liveConnectErrorText(t, failure, NAME[channel]);
  };

  const reset = (message: string | null): void => {
    stop.current?.();
    setSelection(null);
    setChosen(null);
    setPhase('idle');
    setError(message);
  };

  const loadPages = async (code: string): Promise<void> => {
    setPhase('loading');
    try {
      const answer = await api.post<MetaPageSelection>('/channels/meta/pages', { code });
      const usable = connectablePages(answer.pages, channel);
      setSelection(answer);
      setChosen(usable.length === 1 ? usable[0]!.id : null);
      setPhase('choosing');
    } catch (failure) {
      reset(failureText(failure));
    }
  };

  const start = async (): Promise<void> => {
    stop.current?.();
    setError(null);
    // Opened inside the click, before anything is awaited: a browser blocks a
    // pop-up that opens after an asynchronous step.
    const popup = window.open('', 'siyahtus-meta-login', 'popup,width=640,height=760');
    if (!popup) {
      setError(t('settings.channels.meta.popupBlocked'));
      return;
    }
    setPhase('waiting');

    let config: MetaLoginConfig;
    try {
      config = await api.get<MetaLoginConfig>('/channels/meta/login-config');
    } catch (failure) {
      popup.close();
      reset(failureText(failure));
      return;
    }
    const state = newLoginState();
    popup.location.href = loginDialogUrl(config, channel, state);

    let closedAt: number | null = null;
    let received = false;

    const onMessage = (event: MessageEvent): void => {
      const callback = readMetaCallback(event.origin, window.location.origin, event.data, state);
      if (!callback) return;
      received = true;
      stop.current?.();
      if (!popup.closed) popup.close();
      if (!callback.code) {
        reset(t('settings.channels.meta.cancelled'));
        return;
      }
      void loadPages(callback.code);
    };

    const watch = window.setInterval(() => {
      if (!popup.closed || received) return;
      closedAt ??= Date.now();
      if (Date.now() - closedAt < CLOSE_GRACE_MS) return;
      reset(t('settings.channels.meta.cancelled'));
    }, 250);

    window.addEventListener('message', onMessage);
    stop.current = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(watch);
      stop.current = null;
    };
  };

  const submit = async (): Promise<void> => {
    if (!selection || !chosen) return;
    setPhase('connecting');
    try {
      await connect.mutateAsync({ selection_id: selection.selection_id, page_id: chosen });
      reset(null);
    } catch (failure) {
      reset(failureText(failure));
    }
  };

  if ((phase === 'choosing' || phase === 'connecting') && selection) {
    const usable = connectablePages(selection.pages, channel);
    return (
      <div className="flex flex-col gap-2">
        {usable.length === 0 ? (
          <p role="alert" className="text-2xs text-danger">
            {channel === 'instagram'
              ? t('settings.channels.meta.noInstagramPages')
              : t('settings.channels.meta.noPages')}
          </p>
        ) : (
          <fieldset className="flex flex-col gap-1" aria-describedby={`${groupId}-hint`}>
            <legend className="text-2xs font-medium text-content">
              {channel === 'instagram'
                ? t('settings.channels.meta.chooseAccount')
                : t('settings.channels.meta.choosePage')}
            </legend>
            <p id={`${groupId}-hint`} className="text-2xs text-content-tertiary">
              {t('settings.channels.meta.chooseHint')}
            </p>
            {usable.map((page) => (
              <label key={page.id} className="flex items-center gap-2 text-2xs text-content">
                <input
                  type="radio"
                  name={`${groupId}-page`}
                  value={page.id}
                  checked={chosen === page.id}
                  onChange={() => setChosen(page.id)}
                  disabled={phase === 'connecting'}
                />
                <span className="min-w-0 truncate">{pageLabel(page, channel)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="flex gap-2">
          {usable.length > 0 && (
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!chosen || phase === 'connecting'}
              className="rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {phase === 'connecting'
                ? t('settings.channels.meta.connecting')
                : t('settings.channels.meta.connectPage')}
            </button>
          )}
          <button
            type="button"
            onClick={() => reset(null)}
            disabled={phase === 'connecting'}
            className="rounded-md border border-border px-2.5 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {t('settings.channels.meta.cancel')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={phase !== 'idle'}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
      >
        {phase === 'waiting'
          ? t('settings.channels.meta.waiting')
          : phase === 'loading'
            ? t('settings.channels.meta.loadingPages')
            : label}
      </button>
      {error && (
        <p role="alert" className="text-2xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
