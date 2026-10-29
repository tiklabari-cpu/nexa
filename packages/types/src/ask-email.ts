/**
 * Asking the player for an e-mail while nobody answers (WG-08 · tm 342).
 *
 * A player who waits for an answer and leaves takes the conversation with
 * them: the team has nobody to write back to. Two settings on
 * `inbox_settings` (`PUT /settings/chat-timeout`), both off until a workspace
 * turns them on:
 *
 *   - `ask_email_after_seconds` — an open connection with no reply from a
 *     person for this long since it was given to someone (or since it began to
 *     wait, when nobody has it).
 *   - `ask_email_when_offline` — an open connection that waits for a person
 *     while nobody is accepting chats. With an AI answering it waits for the
 *     AI's hand-over, so the player is never asked while the AI is talking.
 *
 * Either way the inactivity sweep writes ONE system event to the connection,
 * and which one depends on whether the team already knows how to reach the
 * player:
 *
 *   - no e-mail and no username → {@link ASK_EMAIL_SYSTEM_EVENT}: the widget
 *     draws an inline card with an e-mail box;
 *   - an e-mail or a username is known → {@link REPLY_HERE_SYSTEM_EVENT}: no
 *     card, a line saying the answer will come to this conversation.
 *
 * The player's answer is {@link ASK_EMAIL_ANSWERED_SYSTEM_EVENT}. The sentence
 * the player reads is written by the server in the player's language, so the
 * transcript an agent opens says what the player was told.
 */
import type { WidgetUiLocale } from './widget.js';

/** `properties.system_event` of the event that makes the widget ask for an e-mail. */
export const ASK_EMAIL_SYSTEM_EVENT = 'ask_email';
/** …of the line that tells a player the team can already reach them: "we will answer here". */
export const REPLY_HERE_SYSTEM_EVENT = 'reply_here';
/** …of the event written when the player gave the address. Carries no address. */
export const ASK_EMAIL_ANSWERED_SYSTEM_EVENT = 'ask_email_answered';

/** The two the sweep writes: at most one of them per connection. */
export const CONTACT_REQUEST_SYSTEM_EVENTS = [
  ASK_EMAIL_SYSTEM_EVENT,
  REPLY_HERE_SYSTEM_EVENT,
] as const;

/** The longest window the settings take: 30 days, like the other inactivity windows. */
export const ASK_EMAIL_MAX_SECONDS = 2_592_000;

/** The longest address the endpoint takes (RFC 5321 path limit). */
export const ASK_EMAIL_ADDRESS_MAX_LENGTH = 254;

export type AskEmailText = 'ask' | 'reply_here' | 'answered';

export const ASK_EMAIL_TEXTS: Readonly<
  Record<WidgetUiLocale, Readonly<Record<AskEmailText, string>>>
> = Object.freeze({
  tr: {
    ask: 'Yanıt biraz gecikiyor. Ayrılmanız gerekirse e-posta adresinizi bırakın, size e-postayla dönelim.',
    reply_here: 'Size bu sohbet üzerinden dönüş yapılacak.',
    answered: 'E-posta adresinizi aldık. Size buradan ya da e-postayla döneceğiz.',
  },
  en: {
    ask: 'The reply is taking a little longer. Leave your e-mail address in case you have to go and we will write back.',
    reply_here: 'We will reply to you here, in this conversation.',
    answered: 'We have your e-mail address. We will reply here or by e-mail.',
  },
  de: {
    ask: 'Die Antwort dauert etwas länger. Hinterlassen Sie Ihre E-Mail-Adresse, falls Sie gehen müssen, und wir schreiben Ihnen zurück.',
    reply_here: 'Wir antworten Ihnen hier in diesem Gespräch.',
    answered: 'Wir haben Ihre E-Mail-Adresse. Wir antworten hier oder per E-Mail.',
  },
  fr: {
    ask: 'La réponse tarde un peu. Laissez votre adresse e-mail au cas où vous devriez partir, nous vous répondrons.',
    reply_here: 'Nous vous répondrons ici, dans cette conversation.',
    answered: 'Nous avons votre adresse e-mail. Nous répondrons ici ou par e-mail.',
  },
  es: {
    ask: 'La respuesta tarda un poco. Deje su correo electrónico por si tiene que irse y le responderemos.',
    reply_here: 'Le responderemos aquí, en esta conversación.',
    answered: 'Tenemos su correo electrónico. Responderemos aquí o por correo.',
  },
  it: {
    ask: 'La risposta sta tardando un po’. Lascia il tuo indirizzo e-mail nel caso tu debba andare e ti risponderemo.',
    reply_here: 'Ti risponderemo qui, in questa conversazione.',
    answered: 'Abbiamo il tuo indirizzo e-mail. Risponderemo qui o via e-mail.',
  },
  pt: {
    ask: 'A resposta está demorando um pouco. Deixe seu e-mail caso precise sair e responderemos.',
    reply_here: 'Responderemos a você aqui, nesta conversa.',
    answered: 'Recebemos seu e-mail. Responderemos aqui ou por e-mail.',
  },
  ar: {
    ask: 'الرد يستغرق وقتًا أطول قليلًا. اترك بريدك الإلكتروني إن اضطررت للمغادرة وسنراسلك.',
    reply_here: 'سنرد عليك هنا في هذه المحادثة.',
    answered: 'وصلنا بريدك الإلكتروني. سنرد هنا أو عبر البريد الإلكتروني.',
  },
});

/**
 * One of the three sentences in the player's language (`tr-TR` → `tr`), or in
 * Turkish when the language is unknown — the line is never skipped for want
 * of a translation (the sensitive-data warning's rule).
 */
export function askEmailText(language: string | null | undefined, which: AskEmailText): string {
  const primary =
    typeof language === 'string' ? (language.trim().toLowerCase().split(/[-_]/)[0] ?? '') : '';
  const known = Object.hasOwn(ASK_EMAIL_TEXTS, primary);
  return ASK_EMAIL_TEXTS[known ? (primary as WidgetUiLocale) : 'tr'][which];
}

/**
 * Whether the team already has a way to reach the player: an e-mail, or the
 * username they typed (their handle on the embedding site). Blank counts as
 * unknown.
 */
export function playerIsReachable(player: {
  email: string | null | undefined;
  username: string | null | undefined;
}): boolean {
  return (player.email ?? '').trim() !== '' || (player.username ?? '').trim() !== '';
}
