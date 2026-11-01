/**
 * Where Meta's embedded-signup dialog sends the pop-up back (tm 380 ·
 * `/channels/whatsapp/callback`, the `redirect_uri` the API hands the card).
 *
 * It does one thing: hand the code and `state` on the address to the card
 * that opened the pop-up — same origin only — and close. It needs no session
 * and renders outside the panel (`main.tsx`), so it works whatever the pop-up
 * is signed in as. The code is useless on its own: only the API, with the app
 * secret, can exchange it.
 */
import { useEffect, type ReactElement } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import { callbackMessageFrom } from './whatsapp-signup.js';

/** The path the API's `redirect_uri` names (`whatsapp-live.ts`). */
export const WHATSAPP_CALLBACK_PATH = '/channels/whatsapp/callback';

export function WhatsAppSignupCallback(): ReactElement {
  const t = useTranslate();
  const opened = typeof window !== 'undefined' && window.opener !== null;

  useEffect(() => {
    if (!window.opener) return;
    window.opener.postMessage(callbackMessageFrom(window.location.search), window.location.origin);
    const timer = window.setTimeout(() => window.close(), 300);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6 text-center">
      <p className="text-sm text-content-secondary">
        {opened
          ? t('settings.channels.whatsapp.callback.done')
          : t('settings.channels.whatsapp.callback.orphan')}
      </p>
    </main>
  );
}
