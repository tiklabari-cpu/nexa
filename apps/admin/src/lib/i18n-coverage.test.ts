/**
 * The i18n sentinel for the root panel (tm 389.6, NFR-I18N2) — the same ratchet apps/web carries,
 * cut to what this app has.
 *
 * The workspace panel was declared translated once on the strength of a language switcher that
 * relabelled the menu and nothing else: 2 of 74 screen files ever called `t()`, and every page
 * body stayed English in both languages. Nothing failed because nothing was watching. This file
 * watches, from the first screen — the budget is zero, so every screen file is either registered
 * (and then held to the catalogue) or proven text-free, and a page added by 389.8–389.20 that
 * forgets either fails on the commit that adds it.
 *
 *  - a screen file that calls `t()` but is not registered is translated work nobody checks;
 *  - a registered file that stopped calling `t()`, grew an English sentence in its markup,
 *    hard-codes a word as a placeholder, or renders a server error message raw, fails;
 *  - a key filed under the wrong namespace, or present in one locale only, fails;
 *  - `common.errors.*` must answer every ADR-06 error type and invent none.
 *
 * The prose check is a heuristic and says so: `// i18n-ignore` on the line (or the line above)
 * answers a real false positive, and the comment should say why.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_TYPES } from '@siyahtus/types';
import { NAMESPACES, NAMESPACE_PREFIXES, NAMESPACED_CATALOGUES } from '../locales/index.js';

/** Directories whose `.tsx` files are user-facing screens. */
const SCREEN_ROOTS = ['src/features', 'src/components'];

/**
 * The files whose translation is claimed — and therefore checked. A page added later registers
 * its files here in the same commit; registering is the act that switches the heuristics on.
 */
const TRANSLATED_FILES: readonly string[] = [
  'src/components/AppShell.tsx',
  'src/components/ForbiddenPage.tsx',
  'src/components/LoadError.tsx',
  'src/components/LoadingPage.tsx',
  'src/components/NotFoundPage.tsx',
  'src/components/PlatformStrip.tsx',
  'src/components/PreferenceControls.tsx',
  'src/components/ReasonDialog.tsx',
  'src/components/settings/FormSaveBar.tsx',
  'src/components/settings/ConfirmHighRisk.tsx',
  'src/components/settings/SaveBar.tsx',
  'src/components/ui/Banner.tsx',
  'src/components/ui/ConfirmDialog.tsx',
  'src/components/ui/Panel.tsx',
  'src/features/auth/ChallengePage.tsx',
  'src/features/auth/InvitePage.tsx',
  'src/features/auth/RecoveryCodesPage.tsx',
  'src/features/auth/SignInPage.tsx',
  'src/features/dashboard/DashboardPage.tsx',
  'src/features/dashboard/HealthSection.tsx',
  'src/features/placeholder/PlaceholderPage.tsx',
];

/**
 * Screen files that carry no user-facing text of their own: the primitives that take every word
 * they render from the caller, and the frames that only arrange what they are handed. The claim
 * is checked below — a file listed here that grows a sentence, or a label-shaped literal, fails
 * and has to move up into `TRANSLATED_FILES`.
 */
const TEXT_FREE_FILES: readonly string[] = [
  'src/components/Page.tsx',
  'src/components/RequirePermission.tsx',
  'src/components/settings/SettingsForm.tsx',
  'src/components/ui/Dropdown.tsx',
  'src/components/ui/Modal.tsx',
  'src/features/auth/AuthLayout.tsx',
];

/** Screen files not yet translated or accounted for. A ratchet that starts at zero: never raise it. */
const REMAINING_BUDGET = 0;

/** Every `.tsx` under the screen roots that is not a test, app-relative and posix-slashed. */
function screenFiles(): string[] {
  const found: string[] = [];
  for (const root of SCREEN_ROOTS) walk(join(process.cwd(), root), found);
  return found
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'))
    .map((file) => relative(process.cwd(), file).split(sep).join('/'))
    .sort();
}

function walk(dir: string, into: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, into);
    else into.push(full);
  }
}

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), 'utf8');
}

/** Whether the file asks `t()` for anything at all. */
function callsTranslate(source: string): boolean {
  return /\bt\(\s*['"`]/.test(source) || /\buseTranslate\(/.test(source);
}

/** Lines carrying an explicit waiver, plus the line after (a comment above the code). */
function waivedLines(source: string): Set<number> {
  const waived = new Set<number>();
  source.split('\n').forEach((line, index) => {
    if (line.includes('i18n-ignore')) {
      waived.add(index + 1);
      waived.add(index + 2);
    }
  });
  return waived;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * Blank out comments, keeping every byte's line number where it was: this codebase's house style
 * writes long JSDoc that quotes JSX, and a scanner that reads comments finds English prose in
 * every one of them. `//` is only a comment when not preceded by `:`, so a URL survives.
 */
function stripComments(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (whole, lead: string) => lead + blank(whole.slice(lead.length)),
    );
}

/**
 * Plain-text JSX children that read like an English sentence: the text between a `>` and the
 * next `<` with no `{`, `}`, `<` or `>` in between, three words or more, at least one lowercase
 * letter, no `=` or `;`. Shorter runs are labels a screen legitimately shares between languages.
 */
function englishProse(original: string): { line: number; text: string }[] {
  const waived = waivedLines(original);
  const source = stripComments(original);
  const hits: { line: number; text: string }[] = [];

  for (const match of source.matchAll(/>([^<>{}]+)</g)) {
    const text = match[1]!.replace(/\s+/g, ' ').trim();
    if (!text || /[=;]/.test(text)) continue;
    if (!/[a-z]/.test(text)) continue;

    const words = text.split(' ').filter((word) => /[A-Za-z]/.test(word));
    if (words.length < 3) continue;

    const line = lineOf(source, match.index + 1);
    if (waived.has(line)) continue;
    hits.push({ line, text });
  }
  return hits;
}

/** `error.message` and friends reaching the screen without passing the catalogue. */
function rawServerMessages(original: string): number[] {
  const waived = waivedLines(original);
  const source = stripComments(original);
  const lines: number[] = [];
  for (const match of source.matchAll(/\b(?:error|err|e|cause|failure|reason)\.message\b/g)) {
    const line = lineOf(source, match.index);
    if (!waived.has(line)) lines.push(line);
  }
  return lines;
}

/** A string literal handed to an attribute a user can read or hear. */
const LITERAL_LABEL_ATTRIBUTE =
  /\b(?:aria-label|aria-description|title|placeholder|alt|label|caption)\s*=\s*(?:["'`]|\{\s*["'`])/g;

/** A label-shaped prop given a hard-coded default in a destructuring pattern. */
const LITERAL_LABEL_DEFAULT =
  /\b\w*(?:Label|Title|Text|Description|Placeholder|Caption)\s*=\s*["'`]/g;

/**
 * Example values that read the same in every language — an address, a path, a range, a time.
 * Anything else handed to `placeholder` as a literal is a word, and a word belongs in the
 * catalogue.
 */
const LANGUAGE_NEUTRAL_PLACEHOLDER = [
  /^[/#]/,
  /^(?:https?:\/\/|urn:)/,
  /^[\d.:/]+$/,
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/,
];

/** String literals handed to `placeholder` that are words in one language. */
function wordPlaceholders(original: string): { line: number; text: string }[] {
  const waived = waivedLines(original);
  const source = stripComments(original);
  const hits: { line: number; text: string }[] = [];
  for (const match of source.matchAll(
    /\bplaceholder\s*=\s*(?:"([^"]*)"|\{\s*['"`]([^'"`]*)['"`]\s*\})/g,
  )) {
    const text = match[1] ?? match[2] ?? '';
    if (!/[A-Za-z]/.test(text)) continue;
    if (LANGUAGE_NEUTRAL_PLACEHOLDER.some((shape) => shape.test(text))) continue;
    const line = lineOf(source, match.index);
    if (!waived.has(line)) hits.push({ line, text });
  }
  return hits;
}

/** `new Error('a sentence')` — prose a person could end up reading. */
function sentenceErrors(original: string): { line: number; text: string }[] {
  const waived = waivedLines(original);
  const source = stripComments(original);
  const hits: { line: number; text: string }[] = [];
  for (const match of source.matchAll(
    /new Error\(\s*(['"`])((?:(?!\1)[^\n])*\s(?:(?!\1)[^\n])*)\1/g,
  )) {
    const line = lineOf(source, match.index);
    if (!waived.has(line)) hits.push({ line, text: match[2]! });
  }
  return hits;
}

/** Every non-test `.ts`/`.tsx` under `src`, app-relative, outside the catalogues and test helpers. */
function sourceFiles(): string[] {
  const found: string[] = [];
  walk(join(process.cwd(), 'src'), found);
  return found
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => relative(process.cwd(), file).split(sep).join('/'))
    .filter((file) => !file.startsWith('src/test/') && !file.startsWith('src/locales/'))
    .sort();
}

const SCREENS = screenFiles();
const REGISTERED = new Set(TRANSLATED_FILES);
const TEXT_FREE = new Set(TEXT_FREE_FILES);

function keysOf(locale: 'en' | 'tr'): string[] {
  return NAMESPACES.flatMap((namespace) => Object.keys(NAMESPACED_CATALOGUES[locale][namespace]));
}

describe('catalogue layout', () => {
  it('ships the same namespace files in every locale', () => {
    for (const [locale, namespaces] of Object.entries(NAMESPACED_CATALOGUES)) {
      expect(Object.keys(namespaces).sort(), `locale ${locale} is missing a namespace`).toEqual([
        ...NAMESPACES,
      ]);
    }
  });

  it('files every key under the namespace that owns its prefix', () => {
    const misfiled: string[] = [];
    for (const [locale, namespaces] of Object.entries(NAMESPACED_CATALOGUES)) {
      for (const namespace of NAMESPACES) {
        const prefixes = NAMESPACE_PREFIXES[namespace];
        for (const key of Object.keys(namespaces[namespace])) {
          if (!prefixes.some((prefix) => key.startsWith(prefix))) {
            misfiled.push(`${locale}/${namespace}.ts: ${key}`);
          }
        }
      }
    }
    expect(misfiled, 'keys filed under a namespace that does not own their prefix').toEqual([]);
  });

  it('carries the identical key set in English and Turkish', () => {
    const en = new Set(keysOf('en'));
    const tr = new Set(keysOf('tr'));

    expect([...en].filter((key) => !tr.has(key)).sort(), 'en keys with no Turkish').toEqual([]);
    expect([...tr].filter((key) => !en.has(key)).sort(), 'tr keys en does not define').toEqual([]);
  });

  it('keeps the same {placeholders} in both languages for every key', () => {
    const slots = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
    const mismatched: string[] = [];
    for (const namespace of NAMESPACES) {
      const en = NAMESPACED_CATALOGUES.en[namespace];
      const tr = NAMESPACED_CATALOGUES.tr[namespace];
      for (const [key, text] of Object.entries(en)) {
        const other = tr[key];
        if (other !== undefined && slots(text).join() !== slots(other).join()) mismatched.push(key);
      }
    }
    expect(mismatched, 'a translation that lost or invented a {placeholder}').toEqual([]);
  });

  it('answers every ADR-06 error type with a sentence, and invents none', () => {
    const expected = [...ERROR_TYPES, 'network', 'unknown']
      .map((type) => `common.errors.${type}`)
      .sort();
    for (const locale of ['en', 'tr'] as const) {
      const actual = Object.keys(NAMESPACED_CATALOGUES[locale].common)
        .filter((key) => key.startsWith('common.errors.'))
        .sort();
      expect(actual, `${locale} error catalogue is out of step with ERROR_TYPES`).toEqual(expected);
    }
  });
});

describe('leaks the markup scan cannot see', () => {
  it('leaves no word as a literal placeholder in a registered file', () => {
    const offenders: string[] = [];
    for (const file of TRANSLATED_FILES) {
      for (const hit of wordPlaceholders(read(file))) {
        offenders.push(`${file}:${hit.line} — ${hit.text}`);
      }
    }
    expect(
      offenders,
      'a placeholder made of words must come from t(); an address, path or range may stay literal',
    ).toEqual([]);
  });

  it('keeps sentence-shaped Error messages developer-only', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (file === 'src/main.tsx') continue;
      for (const hit of sentenceErrors(read(file))) {
        offenders.push(`${file}:${hit.line} — ${hit.text}`);
      }
    }
    expect(
      offenders,
      'an Error whose message is a sentence can reach a screen as `error.message`; throw a code ' +
        'or, for a developer-only guard, say so with // i18n-ignore',
    ).toEqual([]);
  });

  it('knows its own patterns: a word placeholder, an Error sentence and a prose child are caught', () => {
    expect(wordPlaceholders('<input placeholder="Order number" />')).toHaveLength(1);
    expect(wordPlaceholders("<input placeholder={'Billing'} />")).toHaveLength(1);
    for (const neutral of ['/pricing', '10.0.0.0/24', 'shop.example', '09:00', '#2d67fa']) {
      expect(wordPlaceholders(`<input placeholder="${neutral}" />`), neutral).toHaveLength(0);
    }
    expect(
      wordPlaceholders('// i18n-ignore: a name\n<input placeholder="Billing" />'),
    ).toHaveLength(0);

    expect(sentenceErrors("throw new Error('Workspace not found.')")).toHaveLength(1);
    expect(sentenceErrors("throw new Error('workspace_not_found')")).toHaveLength(0);

    expect(englishProse('<p>This is a whole sentence of English.</p>')).toHaveLength(1);
    expect(englishProse('<p>CSV</p>')).toHaveLength(0);
    expect(englishProse('<p>{t("k")}</p>')).toHaveLength(0);
    expect(
      englishProse('{/* i18n-ignore: demo */}\n<p>This is a whole sentence.</p>'),
    ).toHaveLength(0);
    expect(rawServerMessages('setError(error.message)')).toHaveLength(1);
  });
});

describe('screen coverage', () => {
  it('registers every file that already calls t()', () => {
    const unregistered = SCREENS.filter(
      (file) => !REGISTERED.has(file) && callsTranslate(read(file)),
    );
    expect(
      unregistered,
      'these call t() but are not in TRANSLATED_FILES — add them to the list',
    ).toEqual([]);
  });

  it('holds every registered file to the catalogue', () => {
    const silent = TRANSLATED_FILES.filter((file) => !callsTranslate(read(file)));
    expect(silent, 'registered as translated but never calls t()').toEqual([]);
  });

  it('leaves no English sentence in a registered file’s markup', () => {
    const offenders: string[] = [];
    for (const file of TRANSLATED_FILES) {
      for (const hit of englishProse(read(file))) {
        offenders.push(`${file}:${hit.line} — ${hit.text}`);
      }
    }
    expect(
      offenders,
      'untranslated prose in markup; if the heuristic is wrong, say why with // i18n-ignore',
    ).toEqual([]);
  });

  it('never shows a registered file the server’s own error wording', () => {
    const offenders: string[] = [];
    for (const file of TRANSLATED_FILES) {
      for (const line of rawServerMessages(read(file))) {
        offenders.push(`${file}:${line}`);
      }
    }
    expect(
      offenders,
      'server error message used directly — resolve errorMessageKey(error) through t() instead',
    ).toEqual([]);
  });

  it('names no file twice and no file that is gone', () => {
    const claimed = [...TRANSLATED_FILES, ...TEXT_FREE_FILES];
    const duplicated = claimed.filter((file, index) => claimed.indexOf(file) !== index);
    expect(duplicated, 'claimed both translated and text-free').toEqual([]);

    const onDisk = new Set(SCREENS);
    expect(
      claimed.filter((file) => !onDisk.has(file)).sort(),
      'claimed but no longer a screen file — delete the entry',
    ).toEqual([]);
  });

  it('lets no user-facing text into a file claimed text-free', () => {
    const offenders: string[] = [];
    for (const file of TEXT_FREE_FILES) {
      const original = read(file);
      const source = stripComments(original);
      const waived = waivedLines(original);

      for (const hit of englishProse(original)) {
        offenders.push(`${file}:${hit.line} — prose: ${hit.text}`);
      }
      for (const pattern of [LITERAL_LABEL_ATTRIBUTE, LITERAL_LABEL_DEFAULT]) {
        for (const match of source.matchAll(pattern)) {
          const line = lineOf(source, match.index);
          if (!waived.has(line)) offenders.push(`${file}:${line} — literal: ${match[0].trim()}`);
        }
      }
    }
    expect(
      offenders,
      'a primitive claimed text-free now ships words of its own — translate it and register it',
    ).toEqual([]);
  });

  it('leaves no screen file untranslated and unaccounted for', () => {
    const remaining = SCREENS.filter((file) => !REGISTERED.has(file) && !TEXT_FREE.has(file));

    expect(
      remaining.length,
      `untranslated screens grew past the budget:\n${remaining.join('\n')}`,
    ).toBeLessThanOrEqual(REMAINING_BUDGET);
  });
});
