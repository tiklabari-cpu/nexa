/**
 * The words around a message that did not go (tm 437), and where its text goes
 * when the agent takes it back.
 *
 * Before this, a send that failed lost the message twice over: the composer had
 * already cleared the field, and the store rolled the bubble back — so on a weak
 * signal the reply was simply gone. Now the bubble stays, says it was not sent,
 * and offers two ways out: try again (same idempotency key, so a message the
 * server did save is replayed, not doubled) or cancel, which puts the text back
 * in the composer.
 */
import { deviceLocale, type CopyLocale } from './replyGuard';
import type { EventRecipients } from './types';

interface FailedSendCopy {
  /** Under the bubble, in the danger colour. */
  notSent: string;
  retry: string;
  cancel: string;
  /** What Cancel does — read out by the screen reader. */
  cancelHint: string;
}

const COPY: Readonly<Record<CopyLocale, FailedSendCopy>> = {
  en: {
    notSent: 'Not sent.',
    retry: 'Try again',
    cancel: 'Cancel',
    cancelHint: 'Puts the text back in the message box.',
  },
  tr: {
    notSent: 'Gönderilemedi.',
    retry: 'Tekrar dene',
    cancel: 'İptal',
    cancelHint: 'Metni yazma alanına geri koyar.',
  },
};

/** Turkish or English, by the device language — the phone has no catalogue (see `replyGuard.ts`). */
export function failedSendCopy(locale: CopyLocale = deviceLocale()): FailedSendCopy {
  return COPY[locale];
}

/** What the composer holds: the text, and whether it is a reply or an internal note. */
export interface ComposerDraft {
  text: string;
  recipients: EventRecipients;
}

/**
 * The composer after a cancelled message comes back into it.
 *
 * An empty composer simply takes the message, mode included. One that already
 * holds something keeps it — the returned text goes first, since it was
 * written first — and if either of the two was an internal note the result is
 * a note: a note in the reply box is one tap from the customer, which is the
 * expensive mistake on this screen (FR-MOD-02.3.4), while a reply in the note
 * box costs only a tap on "Reply".
 */
export function mergeReturnedDraft(current: ComposerDraft, returned: ComposerDraft): ComposerDraft {
  if (current.text.trim() === '') return { text: returned.text, recipients: returned.recipients };
  return {
    text: `${returned.text}\n${current.text}`,
    recipients:
      current.recipients === 'agents' || returned.recipients === 'agents' ? 'agents' : 'all',
  };
}
