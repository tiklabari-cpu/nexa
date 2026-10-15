/**
 * The identifier names live in one catalogue (ID-01, K1 = A).
 *
 * The code's `chat_id` is the owner's "Thread ID" and its `thread_id` the
 * owner's "Chat ID" — the opposite of what the words suggest — so a screen that
 * spells either name itself is one rename away from teaching the wrong thing.
 * This reads the panel's own source to keep the two terms in `locales/*\/ids.ts`
 * and nowhere else, and checks that catalogue against `ID_GLOSSARY` in
 * `@siyahtus/types` so the glossary and the screen cannot name a number
 * differently.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ID_GLOSSARY, ID_KINDS } from '@siyahtus/types';
import { CATALOGUES } from '../locales/index.js';

/** The two owner terms as a label spells them; `chat_id` / `chatId` are code names and stay. */
const OWNER_ID_TERM = /\b(?:Thread|Chat) ID\b/;
/** The one file per locale allowed to spell them out. */
const IDS_CATALOGUES = new Set(['src/locales/en/ids.ts', 'src/locales/tr/ids.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('identifier names have one home (ID-01)', () => {
  it('spells "Thread ID" / "Chat ID" only in the ids catalogue, never in a screen or another catalogue', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src'))
      .map((file) => relative(process.cwd(), file).split(sep).join('/'))
      .filter((file) => !IDS_CATALOGUES.has(file))
      .flatMap((file) =>
        readFileSync(join(process.cwd(), file), 'utf8')
          .split('\n')
          .flatMap((line, index) =>
            OWNER_ID_TERM.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
          ),
      );
    expect(offenders, 'use t("ids.thread.label") / t("ids.chat.label") instead').toEqual([]);
  });

  it('knows its own pattern: a label is caught, a code field is not', () => {
    expect(OWNER_ID_TERM.test('Thread ID')).toBe(true);
    expect(OWNER_ID_TERM.test('Open the Chat ID row')).toBe(true);
    for (const code of ['chat_id', 'thread_id', 'const chatId = 1', 'the chat id']) {
      expect(OWNER_ID_TERM.test(code), code).toBe(false);
    }
  });
});

describe('the ids catalogue answers ID_GLOSSARY', () => {
  for (const [locale, catalogue] of Object.entries(CATALOGUES)) {
    it(`${locale}: every kind has a label and a hint`, () => {
      for (const kind of ID_KINDS) {
        const info = ID_GLOSSARY[kind];
        expect(catalogue[info.labelKey], `${locale} ${info.labelKey}`).toBeTruthy();
        expect(
          catalogue[info.shortDescriptionKey],
          `${locale} ${info.shortDescriptionKey}`,
        ).toBeTruthy();
      }
    });

    it(`${locale}: the label is the glossary's English screen name`, () => {
      for (const kind of ID_KINDS) {
        const info = ID_GLOSSARY[kind];
        expect(catalogue[info.labelKey]).toBe(info.screenName);
      }
    });

    it(`${locale}: owns no ids.* key the glossary does not name`, () => {
      const named = new Set(
        ID_KINDS.flatMap((kind) => [
          ID_GLOSSARY[kind].labelKey,
          ID_GLOSSARY[kind].shortDescriptionKey,
        ]),
      );
      const stray = Object.keys(catalogue).filter(
        (key) => key.startsWith('ids.') && !named.has(key),
      );
      expect(stray).toEqual([]);
    });
  }

  it('says what each of the two conversation numbers is, in the owner’s words', () => {
    expect(CATALOGUES.tr['ids.thread.hint']).toBe('Üyenin bugünkü konuşma grubu');
    expect(CATALOGUES.tr['ids.chat.hint']).toBe('Bu bağlantı');
    expect(CATALOGUES.en['ids.thread.label']).toBe('Thread ID');
    expect(CATALOGUES.en['ids.chat.label']).toBe('Chat ID');
  });
});
