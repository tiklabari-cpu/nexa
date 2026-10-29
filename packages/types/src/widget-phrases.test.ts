import { describe, expect, it } from 'vitest';
import {
  WIDGET_PHRASE_DEFAULTS,
  WIDGET_PHRASE_KEYS,
  WIDGET_PHRASE_RULES,
  checkWidgetPhrases,
  pickWidgetPhrases,
  pickWidgetUiLocale,
  widgetPhraseProblem,
} from './widget-phrases.js';
import { WIDGET_UI_LOCALES } from './widget.js';

describe('widget phrase rules (tm 344 · WG-05)', () => {
  it('gives every listed key a rule and a default in all eight languages', () => {
    expect(Object.keys(WIDGET_PHRASE_RULES).sort()).toEqual([...WIDGET_PHRASE_KEYS].sort());
    expect(Object.keys(WIDGET_PHRASE_DEFAULTS).sort()).toEqual([...WIDGET_UI_LOCALES].sort());
    for (const locale of WIDGET_UI_LOCALES) {
      for (const key of WIDGET_PHRASE_KEYS) {
        // The shipped text passes its own rule, or the panel could not save it back.
        expect(
          widgetPhraseProblem(key, WIDGET_PHRASE_DEFAULTS[locale][key]),
          `${locale} ${key}`,
        ).toBeNull();
      }
    }
  });

  it('refuses a key outside the closed list', () => {
    expect(widgetPhraseProblem('error.connect', 'Down')).toBe('unknown_key');
    expect(widgetPhraseProblem('__proto__', 'x')).toBe('unknown_key');
  });

  it('refuses an unknown placeholder and accepts the listed ones', () => {
    expect(widgetPhraseProblem('status.queue', 'Sıranız {x}')).toBe('unknown_placeholder');
    expect(widgetPhraseProblem('status.queue', 'Sıranız {}')).toBe('unknown_placeholder');
    // `{minutes}` belongs to the line with an estimate only.
    expect(widgetPhraseProblem('status.queue', '{n}. sıra, {minutes} dk')).toBe(
      'unknown_placeholder',
    );
    expect(widgetPhraseProblem('status.offline', 'Kuyrukta {n}')).toBe('unknown_placeholder');
    expect(widgetPhraseProblem('status.queueWait', '{n}. sıra · yaklaşık {minutes} dk')).toBeNull();
    // A queue line without the position is still a valid line.
    expect(widgetPhraseProblem('status.queue', 'Lütfen bekleyin, sıradasınız')).toBeNull();
  });

  it('keeps texts plain, single-line and within the limit', () => {
    expect(widgetPhraseProblem('status.offline', '<b>Kapalıyız</b>')).toBe('markup');
    expect(widgetPhraseProblem('status.offline', 'a < b ise sorun yok')).toBeNull();
    expect(widgetPhraseProblem('status.offline', 'iki\nsatır')).toBe('line_break');
    expect(widgetPhraseProblem('status.offline', `ayraç${String.fromCharCode(0x2028)}var`)).toBe(
      'line_break',
    );
    expect(widgetPhraseProblem('prechat.submit', 'x'.repeat(40))).toBeNull();
    expect(widgetPhraseProblem('prechat.submit', 'x'.repeat(41))).toBe('too_long');
    // Counted in characters: forty Turkish letters are forty, not eighty bytes.
    expect(widgetPhraseProblem('prechat.submit', 'ğ'.repeat(40))).toBeNull();
    expect(widgetPhraseProblem('prechat.submit', '   ')).toBe('empty');
  });

  it('trims a whole language and names the first refused key', () => {
    expect(checkWidgetPhrases({ 'status.offline': '  Değerli üyemiz, şu an kapalıyız. ' })).toEqual(
      {
        ok: true,
        phrases: { 'status.offline': 'Değerli üyemiz, şu an kapalıyız.' },
      },
    );
    expect(
      checkWidgetPhrases({ 'input.placeholder': 'Yazın', 'status.queue': 'Sıra {pos}' }),
    ).toEqual({ ok: false, key: 'status.queue', problem: 'unknown_placeholder' });
  });

  it('hands the widget only listed keys from stored rows', () => {
    expect(
      pickWidgetPhrases([
        { key: 'status.offline', text: 'Kapalı' },
        { key: 'retired.key', text: 'eski' },
      ]),
    ).toEqual({ 'status.offline': 'Kapalı' });
  });
});

describe('pickWidgetUiLocale (WG-02, shared by the widget and the mint)', () => {
  it('prefers the snippet, then a pinned panel language, then the browser, then the fallback', () => {
    expect(pickWidgetUiLocale({ snippet: 'de', panel: 'tr', browser: ['fr'] })).toBe('de');
    expect(pickWidgetUiLocale({ snippet: 'ru', panel: 'tr', browser: ['fr'] })).toBe('tr');
    expect(pickWidgetUiLocale({ panel: 'auto', browser: ['ru-RU', 'pt-BR'], fallback: 'tr' })).toBe(
      'pt',
    );
    expect(pickWidgetUiLocale({ panel: 'auto', browser: ['ru'], fallback: 'tr' })).toBe('tr');
    expect(pickWidgetUiLocale({})).toBe('en');
  });
});
