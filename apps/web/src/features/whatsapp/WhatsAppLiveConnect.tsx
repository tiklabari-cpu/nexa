/**
 * "Connect with Meta" — the live WhatsApp card's connect step (tm 380 · KN-01).
 *
 * One click opens Meta's embedded signup in a pop-up (`whatsapp-signup.ts`);
 * the business picks or creates its WhatsApp Business account and number
 * there. When both halves are back — Meta's session info (account, number)
 * and the code relayed by the callback page — the card posts them to
 * `POST /channels/whatsapp/connect`, which exchanges the code and checks the
 * number itself. Closing the pop-up early, a blocked pop-up and every refusal
 * the API gives are said in the card, in the console's language.
 *
 * The same control reconnects a channel Meta stopped accepting (Graph error
 * 190): a fresh signup is the only way to a fresh business token.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { liveConnectErrorText } from '../apps/live-errors.js';
import {
  newSignupState,
  readCallback,
  readSessionInfo,
  signupDialogUrl,
  type WhatsAppConnectBody,
  type WhatsAppSignupConfig,
} from './whatsapp-signup.js';

/** How long after the pop-up closes a late message is still waited for. */
const CLOSE_GRACE_MS = 1500;

type Phase = 'idle' | 'waiting' | 'connecting';

export function WhatsAppLiveConnect({ label }: { label: string }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const client = useQueryClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const connect = useMutation({
    mutationFn: (body: WhatsAppConnectBody) => api.post('/channels/whatsapp/connect', body),
    onSuccess: () => client.invalidateQueries({ queryKey: ['channels'] }),
  });

  const failureText = (failure: unknown): string => {
    if (
      failure instanceof ApiClientError &&
      failure.details?.['reason'] === 'whatsapp_number_not_in_account'
    ) {
      return t('settings.channels.whatsapp.live.notInAccount');
    }
    return liveConnectErrorText(t, failure, 'WhatsApp');
  };

  const start = async (): Promise<void> => {
    stop.current?.();
    setError(null);
    // Opened inside the click, before anything is awaited: a browser blocks a
    // pop-up that opens after an asynchronous step.
    const popup = window.open('', 'siyahtus-whatsapp-signup', 'popup,width=640,height=760');
    if (!popup) {
      setError(t('settings.channels.whatsapp.live.popupBlocked'));
      return;
    }
    setPhase('waiting');

    let config: WhatsAppSignupConfig;
    try {
      config = await api.get<WhatsAppSignupConfig>('/channels/whatsapp/signup-config');
    } catch (failure) {
      popup.close();
      setPhase('idle');
      setError(failureText(failure));
      return;
    }
    const state = newSignupState();
    popup.location.href = signupDialogUrl(config, state);

    let session: { wabaId: string; phoneNumberId: string } | null = null;
    let code: string | null = null;
    let closedAt: number | null = null;

    const end = (message: string | null): void => {
      stop.current?.();
      setPhase('idle');
      setError(message);
    };

    const submit = async (body: WhatsAppConnectBody): Promise<void> => {
      stop.current?.();
      if (!popup.closed) popup.close();
      setPhase('connecting');
      try {
        await connect.mutateAsync(body);
        setPhase('idle');
      } catch (failure) {
        setPhase('idle');
        setError(failureText(failure));
      }
    };

    const onMessage = (event: MessageEvent): void => {
      const info = readSessionInfo(event.origin, event.data);
      if (info?.kind === 'finish') {
        session = { wabaId: info.wabaId, phoneNumberId: info.phoneNumberId };
      } else if (info?.kind === 'cancel') {
        end(t('settings.channels.whatsapp.live.cancelled'));
        return;
      } else if (info?.kind === 'error') {
        end(t('settings.channels.whatsapp.live.incomplete'));
        return;
      }
      const callback = readCallback(event.origin, window.location.origin, event.data, state);
      if (callback) {
        if (!callback.code) {
          end(t('settings.channels.whatsapp.live.cancelled'));
          return;
        }
        code = callback.code;
      }
      if (session && code) {
        void submit({ code, waba_id: session.wabaId, phone_number_id: session.phoneNumberId });
      }
    };

    // The pop-up closed without both halves: cancelled, or — with a code and no
    // number — a signup Meta did not finish telling us about.
    const watch = window.setInterval(() => {
      if (!popup.closed) return;
      closedAt ??= Date.now();
      if (Date.now() - closedAt < CLOSE_GRACE_MS) return;
      end(
        code
          ? t('settings.channels.whatsapp.live.incomplete')
          : t('settings.channels.whatsapp.live.cancelled'),
      );
    }, 250);

    window.addEventListener('message', onMessage);
    stop.current = () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(watch);
      stop.current = null;
    };
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={phase !== 'idle'}
        className="self-start rounded-md bg-brand-500 px-2.5 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
      >
        {phase === 'waiting'
          ? t('settings.channels.whatsapp.live.waiting')
          : phase === 'connecting'
            ? t('settings.channels.whatsapp.live.connecting')
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
