/**
 * The Help tab's module on its own (WG-12 · tm 348): the article renderer
 * builds elements and text nodes only, so nothing an author wrote becomes
 * markup (NFR-S6); only an http(s) address becomes a link, in a new tab with
 * `noopener`; an answer that arrives after a newer question is not drawn; the
 * bounds it copies are the ones `@siyahtus/types` gives the API.
 */
import { KB_SEARCH_LIMIT, KB_SEARCH_QUERY_MAX, KB_SEARCH_QUERY_MIN } from '@siyahtus/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGS } from './locales/index.js';
import {
  helpText,
  openHelp,
  PAGE_SIZE,
  QUERY_MAX,
  QUERY_MIN,
  renderArticleBody,
  type HelpHost,
} from './help.js';

function draw(body: string): HTMLElement {
  const host = document.createElement('div');
  host.append(renderArticleBody(document, body));
  return host;
}

beforeEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe('Help tab module (WG-12)', () => {
  it('bounds the search the way the API does', () => {
    expect([QUERY_MIN, QUERY_MAX, PAGE_SIZE]).toEqual([
      KB_SEARCH_QUERY_MIN,
      KB_SEARCH_QUERY_MAX,
      KB_SEARCH_LIMIT.default,
    ]);
  });

  it('speaks the widget’s eight languages, English for anything else', () => {
    for (const locale of Object.keys(CATALOGS)) {
      expect(Object.values(helpText(locale)).every((value) => value.trim() !== '')).toBe(true);
    }
    expect(helpText('tr').chat).toBe('Sohbet başlat');
    expect(helpText('xx')).toBe(helpText('en'));
  });

  it('draws the markdown subset as elements, headings under the article title', () => {
    const out = draw(
      '## Adımlar\n\n- **Papara**yı seçin\n- `TRY` girin\n\n### Not\nBir satır\nve devamı.',
    );
    expect([...out.children].map((el) => el.tagName)).toEqual(['H3', 'UL', 'H4', 'P']);
    expect(out.querySelector('ul')!.children).toHaveLength(2);
    expect(out.querySelector('strong')!.textContent).toBe('Papara');
    expect(out.querySelector('code')!.textContent).toBe('TRY');
    expect(out.querySelector('p')!.textContent).toBe('Bir satır ve devamı.');
  });

  it('never turns author text into markup, and links only http(s) in a new tab (NFR-S6)', () => {
    const out = draw(
      '<img src=x onerror=alert(1)> [ok](https://casino.example/a) [bad](javascript:alert(1)) **<b>x</b>**',
    );
    expect(out.querySelector('img, b, script')).toBeNull();
    expect(out.textContent).toContain('<img src=x onerror=alert(1)>');
    const links = out.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.href).toBe('https://casino.example/a');
    expect(links[0]!.target).toBe('_blank');
    expect(links[0]!.rel).toBe('noopener noreferrer nofollow');
    expect(out.textContent).toContain('[bad](javascript:alert(1))');
    expect(out.querySelector('strong')!.textContent).toBe('<b>x</b>');
  });

  it('draws only the newest question’s answer, and an error as a sentence', async () => {
    const panel = document.createElement('section');
    const header = document.createElement('header');
    header.className = 'nx-header';
    panel.append(header);
    document.body.append(panel);
    const answers: Record<string, (value: unknown) => void> = {};
    const host: HelpHost = {
      doc: document,
      panel,
      locale: 'en',
      get: <T>(path: string) =>
        new Promise<T>((resolve, reject) => {
          const q = new URL(path, 'https://x.test').searchParams.get('q')!;
          if (q === 'boom') reject(new Error('down'));
          answers[q] = resolve as (value: unknown) => void;
        }),
      chat: vi.fn(),
      closed: vi.fn(),
    };
    const view = openHelp(host);
    const input = panel.querySelector('input')!;
    const form = panel.querySelector('form')!;
    const ask = (q: string) => {
      input.value = q;
      form.dispatchEvent(new Event('submit', { cancelable: true }));
    };

    ask('papara');
    ask('bonus');
    answers['bonus']!({ items: [{ slug: 'b', title: 'Bonus', excerpt: '' }] });
    await vi.waitFor(() => expect(panel.querySelectorAll('.nx-help-hit')).toHaveLength(1));
    answers['papara']!({ items: [{ slug: 'p', title: 'Papara', excerpt: '' }] });
    await Promise.resolve();
    expect(panel.querySelector('.nx-help-hit strong')!.textContent).toBe('Bonus');

    ask('boom');
    await vi.waitFor(() =>
      expect(panel.querySelector('[role="status"]')!.textContent).toBe(helpText('en').error),
    );
    expect(panel.querySelectorAll('.nx-help-hit')).toHaveLength(0);

    view.close();
    expect(panel.querySelector('.nx-help')).toBeNull();
    expect(host.closed).toHaveBeenCalledTimes(1);
  });

  it('waits for a pause in typing before it asks', async () => {
    vi.useFakeTimers();
    try {
      const panel = document.createElement('section');
      document.body.append(panel);
      const asked: string[] = [];
      const get = async <T>(path: string): Promise<T> => {
        asked.push(path);
        return { items: [] } as T;
      };
      openHelp({ doc: document, panel, locale: 'en', get, chat: vi.fn(), closed: vi.fn() });
      const input = panel.querySelector('input')!;
      for (const value of ['p', 'pa', 'pap', 'papa']) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        vi.advanceTimersByTime(100);
      }
      expect(asked).toHaveLength(0);
      vi.advanceTimersByTime(300);
      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain('q=papa');
    } finally {
      vi.useRealTimers();
    }
  });
});
