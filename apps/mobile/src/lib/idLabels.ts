/**
 * The phone's names for the numbers it shows (ID-01, K1 = A).
 *
 * The mobile app has no i18n catalogue, so the label and hint text for every
 * identifier kind lives here, in one file, instead of inside screens. The
 * labels are `@siyahtus/types`' `ID_GLOSSARY` screen names — the same English
 * terms the web panel shows — so the two surfaces cannot disagree; only the
 * hints are written out. A screen asks `idLabel(kind)` / `idHint(kind)` and
 * never spells "Thread ID" or "Chat ID" itself.
 *
 * Reminder of the mapping, because the code words are the opposite of the
 * owner's: `chat_id` (the member's day) is shown as the day-thread label and
 * `thread_id` (one connection) as the connection label. Field names, API
 * payloads and log keys keep the code names.
 */
import { ID_GLOSSARY, type IdKind } from '@siyahtus/types';

/** One-line "what is this number", Turkish like the rest of the phone app. */
const HINTS: Readonly<Record<IdKind, string>> = {
  day_thread: 'Üyenin bugünkü konuşma grubu',
  connection: 'Bu bağlantı',
  event: 'Tek bir mesaj — ait olduğu Chat ID ile başlar',
  customer: 'Üyenin kendi numarası — teknik, paylaşılmaz',
  request: 'Tek bir sunucu isteği — hata mesajlarında ve loglarda görünür',
  ticket: 'Tek bir ticket',
  ai_decision: 'Yapay zekâ temsilcisinin tek bir kararı',
};

export function idLabel(kind: IdKind): string {
  return ID_GLOSSARY[kind].screenName;
}

export function idHint(kind: IdKind): string {
  return HINTS[kind];
}
