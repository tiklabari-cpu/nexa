/**
 * The i18n primitive: lookup, fallback, interpolation, and locale detection.
 *
 * `translate` is pure and locale-explicit, so the fallback chain — active locale
 * → English → the key itself — is tested here without a store or React in the
 * way. The fallback is the load-bearing part: a screen half-translated must show
 * English, never a raw `some.key`, and a key that exists nowhere must not throw.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ApiClientError, errorMessageKey } from './api-client.js';
import { formatCount, setFormatLocale } from './format.js';
import { detectLocale, translate, useLocaleStore, type Locale } from './i18n.js';
import { mergeNamespaces, NAMESPACES, type Messages, type Namespace } from '../locales/index.js';

describe('translate', () => {
  it('returns the active locale’s string when it exists', () => {
    expect(translate('en', 'nav.inbox')).toBe('Inbox');
    expect(translate('tr', 'nav.inbox')).toBe('Gelen Kutusu');
  });

  it('falls back to the key itself for a key present in no catalogue', () => {
    // Missing-key safety: the UI shows the (developer-facing) key rather than
    // crashing or rendering "undefined".
    expect(translate('en', 'does.not.exist')).toBe('does.not.exist');
    expect(translate('tr', 'does.not.exist')).toBe('does.not.exist');
  });

  it('falls back to English when a locale lacks a key', () => {
    // Simulate a partially translated locale by asking for a key through a cast
    // to a catalogue that does not carry it; English must answer.
    const partial = 'zz' as unknown as Locale;
    expect(translate(partial, 'nav.reports')).toBe('Reports');
  });

  it('interpolates named params and ignores unused ones', () => {
    expect(translate('en', 'palette.ai.source', { source: 'Knowledge base', unused: 1 })).toBe(
      'Source: Knowledge base',
    );
    expect(translate('tr', 'palette.ai.source', { source: 'Bilgi tabanı' })).toBe(
      'Kaynak: Bilgi tabanı',
    );
  });

  it('leaves an unmatched placeholder untouched', () => {
    expect(translate('en', 'palette.ai.ask', {})).toBe('Ask AI: "{query}"');
  });
});

describe('detectLocale', () => {
  afterEach(() => {
    globalThis.localStorage.removeItem('nexa.locale');
  });

  it('honours a remembered choice, coercing the region away', () => {
    globalThis.localStorage.setItem('nexa.locale', 'tr');
    expect(detectLocale()).toBe('tr');
    globalThis.localStorage.setItem('nexa.locale', 'tr-TR');
    expect(detectLocale()).toBe('tr');
  });

  it('falls back to English for an unsupported remembered value', () => {
    globalThis.localStorage.setItem('nexa.locale', 'de');
    expect(detectLocale()).toBe('en');
  });
});

describe('plurals', () => {
  // Plural forms are a key-suffix convention (`key.one` / `key.other`) resolved
  // through `Intl.PluralRules`, chosen over a message syntax so the rules live
  // in the language rather than in the interpolator. The trial banner is the
  // live case: it used to pass a hand-rolled `{s}` marker the caller computed.
  it('picks the English form the count calls for', () => {
    expect(translate('en', 'shell.trial.remaining', { count: 1 })).toBe(
      '1 day left in your trial.',
    );
    expect(translate('en', 'shell.trial.remaining', { count: 3 })).toBe(
      '3 days left in your trial.',
    );
    expect(translate('en', 'shell.trial.remaining', { count: 0 })).toBe(
      '0 days left in your trial.',
    );
  });

  it('reads the same in Turkish at any count, without falling back to English', () => {
    // Turkish selects `one` for 1 like English does; it simply has the same text
    // there. The assertion that matters is that neither count leaks English.
    expect(translate('tr', 'shell.trial.remaining', { count: 1 })).toBe(
      'Deneme sürenizde 1 gün kaldı.',
    );
    expect(translate('tr', 'shell.trial.remaining', { count: 5 })).toBe(
      'Deneme sürenizde 5 gün kaldı.',
    );
  });

  it('leaves a message with no plural forms exactly as it was', () => {
    // Everything written before plurals existed must resolve as before, `count`
    // param or not — the suffixed lookups miss and the plain key answers.
    expect(translate('en', 'shell.trial.ended', { count: 2 })).toBe(
      'Your trial has ended — subscribe to start new conversations.',
    );
  });

  it('leaves a key with no catalogue entry alone whatever the count', () => {
    expect(translate('en', 'does.not.exist', { count: 1 })).toBe('does.not.exist');
    expect(translate('tr', 'does.not.exist', { count: 5 })).toBe('does.not.exist');
  });
});

describe('catalogue', () => {
  it('resolves a key from every namespace file', () => {
    // The split is organisational: a key reads the same wherever its file is.
    expect(translate('en', 'nav.inbox')).toBe('Inbox'); // shell.ts
    expect(translate('en', 'playbook.template.order-status.name')).toBe('Where is my order?');
    expect(translate('tr', 'common.errors.not_found')).toBe('Bunu bulamadık.');
  });

  it('refuses to merge a key defined twice', () => {
    // Silent last-write-wins is the failure this guards: two namespaces claiming
    // one key would resolve by merge order, which no reader can see.
    expect(() =>
      mergeNamespaces('en', {
        ...emptyNamespaces(),
        shell: { 'shell.brand': 'Brand' },
        common: { 'shell.brand': 'Marka' },
      }),
    ).toThrow(/duplicate key "shell.brand"/);
  });
});

function emptyNamespaces(): Record<Namespace, Messages> {
  return Object.fromEntries(NAMESPACES.map((name) => [name, {}])) as Record<Namespace, Messages>;
}

describe('errorMessageKey', () => {
  it('names the catalogue entry for an ADR-06 type', () => {
    const error = new ApiClientError({
      type: 'chat_inactive',
      status: 409,
      message: 'Chat is not active.',
      requestId: 'rq-1',
    });
    expect(errorMessageKey(error)).toBe('common.errors.chat_inactive');
    // And the sentence the user sees is the catalogue's, in their language —
    // never the server's English prose.
    expect(translate('tr', errorMessageKey(error))).toBe('Bu sohbet artık etkin değil.');
  });

  it('covers the client-only network failure', () => {
    const error = new ApiClientError({
      type: 'network',
      status: 0,
      message: 'Could not reach the server.',
      requestId: '-',
    });
    expect(translate('en', errorMessageKey(error))).toBe(
      'Could not reach the server — check your connection.',
    );
  });

  it('falls back to the generic sentence for anything else', () => {
    // A plain Error, and a type off the wire that this build has never heard of
    // — neither may reach the screen as a raw key.
    expect(errorMessageKey(new Error('boom'))).toBe('common.errors.unknown');
    expect(
      errorMessageKey(
        new ApiClientError({
          type: 'invented_by_a_proxy' as never,
          status: 418,
          message: 'nope',
          requestId: 'rq-2',
        }),
      ),
    ).toBe('common.errors.unknown');
  });
});

describe('the store’s side effects', () => {
  afterEach(() => {
    useLocaleStore.getState().setLocale('en');
    // Put back the suite-wide pin `vitest.setup.ts` installed (tm 108) — this
    // file just overwrote it by switching languages for real.
    setFormatLocale('en-US');
    globalThis.localStorage.removeItem('nexa.locale');
  });

  it('re-points the Intl helpers, so numbers and dates follow the chosen language', () => {
    // This is the binding that makes `formatCount()` in a component follow the
    // switcher without any call site passing a locale. Nothing else asserts it:
    // `format.test.ts` calls `setFormatLocale` directly, which would keep
    // passing if the store stopped calling it.
    useLocaleStore.getState().setLocale('tr');
    expect(formatCount(1234)).toBe('1.234');

    useLocaleStore.getState().setLocale('en');
    expect(formatCount(1234)).toBe('1,234');
  });

  it('remembers the choice and tells the document what language it is in', () => {
    useLocaleStore.getState().setLocale('tr');
    expect(globalThis.localStorage.getItem('nexa.locale')).toBe('tr');
    expect(document.documentElement.lang).toBe('tr');
  });
});
