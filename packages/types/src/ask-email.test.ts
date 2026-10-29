import { describe, expect, it } from 'vitest';
import {
  ASK_EMAIL_TEXTS,
  CONTACT_REQUEST_SYSTEM_EVENTS,
  askEmailText,
  playerIsReachable,
} from './ask-email.js';
import { WIDGET_UI_LOCALES } from './widget.js';

describe('askEmailText (WG-08)', () => {
  it('has all three sentences in each of the widget languages, none blank', () => {
    expect(Object.keys(ASK_EMAIL_TEXTS).sort()).toEqual([...WIDGET_UI_LOCALES].sort());
    for (const locale of WIDGET_UI_LOCALES) {
      for (const which of ['ask', 'reply_here', 'answered'] as const) {
        expect(ASK_EMAIL_TEXTS[locale][which].trim().length).toBeGreaterThan(10);
      }
    }
  });

  it('reads the primary language of a tag, and falls back to Turkish for an unknown or missing one', () => {
    expect(askEmailText('en-GB', 'reply_here')).toBe(ASK_EMAIL_TEXTS.en.reply_here);
    expect(askEmailText('DE_at', 'ask')).toBe(ASK_EMAIL_TEXTS.de.ask);
    expect(askEmailText('ru', 'ask')).toBe(ASK_EMAIL_TEXTS.tr.ask);
    expect(askEmailText(null, 'answered')).toBe(ASK_EMAIL_TEXTS.tr.answered);
    expect(askEmailText('constructor', 'ask')).toBe(ASK_EMAIL_TEXTS.tr.ask);
  });

  it('names the two events a connection gets at most one of', () => {
    expect([...CONTACT_REQUEST_SYSTEM_EVENTS]).toEqual(['ask_email', 'reply_here']);
  });
});

describe('playerIsReachable (WG-08)', () => {
  it('is true for an e-mail or a username, false for neither or blanks', () => {
    expect(playerIsReachable({ email: 'a@b.co', username: null })).toBe(true);
    expect(playerIsReachable({ email: null, username: 'oyuncu42' })).toBe(true);
    expect(playerIsReachable({ email: null, username: null })).toBe(false);
    expect(playerIsReachable({ email: ' ', username: '' })).toBe(false);
    expect(playerIsReachable({ email: undefined, username: undefined })).toBe(false);
  });
});
