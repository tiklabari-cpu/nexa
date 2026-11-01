/**
 * The public API documentation viewer (KN-04 · tm 376), against the real published
 * document (`public/developers/docs/openapi.json`, committed and kept fresh by the
 * contract package's own test).
 *
 * What is held here: the page can be searched, every published operation renders,
 * and nothing in the page can run script — descriptions are text, links are
 * filtered, and the markup carries no inline handler or style, because the page is
 * served under the panel's Content-Security-Policy.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.js';
import {
  parseRoute,
  renderNavigation,
  renderOperation,
  renderRoute,
  renderSearchResults,
} from './render.js';
import {
  baseUrlOf,
  buildModel,
  curlExample,
  exampleValue,
  schemaRows,
  searchOperations,
  type Spec,
} from './spec.js';

const spec = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../public/developers/docs/openapi.json'), 'utf8'),
) as Spec;
const model = buildModel(spec);

/** The markup of a view, serialised (the lint rule bans reading `innerHTML`). */
const html = (node: Node): string => new XMLSerializer().serializeToString(node);

describe('the documentation page can be searched', () => {
  it('lists every published operation and groups them by tag', () => {
    expect(model.operations.length).toBeGreaterThan(40);
    expect(model.groups.map((group) => group.name)).toContain('Webhooks');
    expect(model.groups.reduce((sum, group) => sum + group.operations.length, 0)).toBe(
      model.operations.length,
    );
  });

  it('finds an operation by what it does, in any word order', () => {
    expect(searchOperations(model, 'transfer chat').map((entry) => entry.id)).toContain(
      'transferChat',
    );
    expect(searchOperations(model, 'chat transfer').map((entry) => entry.id)).toContain(
      'transferChat',
    );
    expect(searchOperations(model, 'webhook').length).toBeGreaterThanOrEqual(7);
  });

  it('finds an operation by its path, its method and its operation id', () => {
    expect(searchOperations(model, '/chats/{chatId}/events').length).toBeGreaterThan(0);
    expect(searchOperations(model, 'DELETE webhooks').map((entry) => entry.id)).toContain(
      'unregisterWebhook',
    );
    expect(searchOperations(model, 'registerwebhook').map((entry) => entry.id)).toContain(
      'registerWebhook',
    );
  });

  it('answers a nonsense query with nothing, and an empty one with everything', () => {
    expect(searchOperations(model, 'zzzxqv')).toEqual([]);
    expect(searchOperations(model, '   ')).toHaveLength(model.operations.length);
  });

  it('cannot find an internal operation, because none is on the page', () => {
    for (const word of ['impersonation', 'sandbox', 'platform', 'scim']) {
      expect(searchOperations(model, `/${word}`).map((entry) => entry.path)).toEqual([]);
    }
  });

  it('shows the matches in the list and in the results view', () => {
    const results = searchOperations(model, 'webhook');
    const matches = new Set(results.map((entry) => entry.id));
    const nav = renderNavigation(document, model, matches, { kind: 'home' });
    expect(nav.querySelectorAll('a.op-link')).toHaveLength(results.length);
    expect(nav.textContent).not.toContain('Guides');

    const view = renderSearchResults(document, results, 'webhook');
    expect(view.querySelectorAll('li')).toHaveLength(results.length);
    expect(renderSearchResults(document, [], 'nothing').textContent).toContain(
      'No operation matches',
    );
  });
});

describe('every published operation renders', () => {
  it('draws a heading, the method and path and the example, for each of them', () => {
    for (const entry of model.operations) {
      const view = renderOperation(document, model, entry);
      expect(view.querySelector('h1')?.textContent, entry.id).toBeTruthy();
      expect(view.querySelector('.signature code')?.textContent).toBe(entry.path);
      expect(view.querySelector('.signature .method')?.textContent).toBe(
        entry.method.toUpperCase(),
      );
      expect(view.querySelector('pre[data-lang="bash"]')?.textContent).toContain(
        `curl -X ${entry.method.toUpperCase()}`,
      );
      expect(view.querySelectorAll('.response').length, entry.id).toBeGreaterThan(0);
    }
  });

  it('writes the credential into the example unless the operation needs none', () => {
    const send = curlExample(model, model.byId.get('sendEvent')!, { baseUrl: baseUrlOf(spec) });
    expect(send).toContain('-u "$ACCOUNT_ID:$SIYAHTUS_PAT"');
    expect(send).toContain('Content-Type: application/json');
    expect(send).toContain('<chatId>');

    const health = curlExample(model, model.byId.get('getHealthLive')!, {
      baseUrl: baseUrlOf(spec),
    });
    expect(health).not.toContain('-u ');
  });

  it('points the example at the production server, not at localhost', () => {
    expect(baseUrlOf(spec)).not.toMatch(/localhost/);
  });

  it('leaves no inline script, style or handler anywhere in any view', () => {
    const views = [
      renderRoute(document, model, { kind: 'home' }),
      renderRoute(document, model, { kind: 'changelog' }),
      ...(spec['x-guides'] ?? []).map((guide) =>
        renderRoute(document, model, { kind: 'guide', id: guide.id }),
      ),
      ...model.operations.map((entry) => renderOperation(document, model, entry)),
      renderNavigation(document, model, null, { kind: 'home' }),
    ];
    for (const view of views) {
      const markup = html(view);
      expect(markup).not.toMatch(/<script/i);
      expect(markup).not.toMatch(/<style/i);
      expect(markup).not.toMatch(/\sstyle=/i);
      expect(markup).not.toMatch(/\son[a-z]+=/i);
      expect(markup).not.toMatch(/javascript:/i);
    }
  });

  it('shows the guides, and a changelog that names the current version', () => {
    expect(renderRoute(document, model, { kind: 'guide', id: 'webhooks' }).textContent).toContain(
      'X-Webhook-Signature',
    );
    expect(renderRoute(document, model, { kind: 'changelog' }).textContent).toContain(
      `Version ${spec.info.version}`,
    );
    expect(renderRoute(document, model, { kind: 'guide', id: 'nope' }).textContent).toContain(
      'not found',
    );
    expect(renderRoute(document, model, { kind: 'operation', id: 'nope' }).textContent).toContain(
      'Not found',
    );
  });

  it('marks the open operation in the list', () => {
    const nav = renderNavigation(document, model, null, { kind: 'operation', id: 'sendEvent' });
    expect(nav.querySelector('[aria-current="page"]')?.getAttribute('data-operation')).toBe(
      'sendEvent',
    );
  });
});

describe('prose is text, never markup', () => {
  it('keeps a script tag in a description as text', () => {
    const fragment = renderMarkdown(
      document,
      'Hello <script>alert(1)</script> and <img src=x onerror=alert(1)>',
    );
    const holder = document.createElement('div');
    holder.appendChild(fragment);
    expect(holder.querySelector('script, img')).toBeNull();
    expect(holder.textContent).toContain('<script>alert(1)</script>');
  });

  it('follows only http, https and in-page links', () => {
    const holder = document.createElement('div');
    holder.appendChild(
      renderMarkdown(
        document,
        '[ok](https://example.com) [in page](#/changelog) [bad](javascript:alert(1)) [data](data:text/html,x)',
      ),
    );
    const hrefs = [...holder.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://example.com', '#/changelog']);
    expect(holder.querySelector('a[href^="https"]')?.getAttribute('rel')).toContain('noopener');
    expect(holder.textContent).toContain('bad');
  });

  it('renders headings, lists, tables and fenced code', () => {
    const holder = document.createElement('div');
    holder.appendChild(
      renderMarkdown(
        document,
        [
          '## Title',
          '',
          'Para with `code` and **bold**.',
          '',
          '- one',
          '- two',
          '',
          '| A | B |',
          '| - | - |',
          '| 1 | 2 |',
          '',
          '```js',
          'const a = 1;',
          '```',
        ].join('\n'),
        1,
      ),
    );
    expect(holder.querySelector('h3')?.textContent).toBe('Title');
    expect(holder.querySelectorAll('li')).toHaveLength(2);
    expect(holder.querySelector('td')?.textContent).toBe('1');
    expect(holder.querySelector('pre[data-lang="js"] code')?.textContent).toBe('const a = 1;');
    expect(holder.querySelector('strong')?.textContent).toBe('bold');
  });
});

describe('schemas are bounded and readable', () => {
  const recursive: Spec = {
    openapi: '3.1.0',
    info: { title: 't', version: '1' },
    paths: {},
    components: {
      schemas: {
        Node: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } },
        },
      },
    },
  };

  it('does not follow a self-referencing schema forever', () => {
    const rows = schemaRows(recursive, { $ref: '#/components/schemas/Node' });
    expect(rows.length).toBeLessThan(20);
    expect(rows.map((row) => row.name)).toContain('body.child');
    expect(rows.find((row) => row.name === 'body.id')?.required).toBe(true);
    expect(
      JSON.stringify(exampleValue(recursive, { $ref: '#/components/schemas/Node' })),
    ).toBeTruthy();
  });

  it('lists enum values and constraints on a real operation', () => {
    const rows = schemaRows(spec, {
      $ref: '#/components/schemas/WebhookAction',
    });
    expect(rows[0]!.values).toContain('chat_started');
  });
});

describe('addresses', () => {
  it('turns the location hash into a view, and unknown ones into a missing page', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute('#/')).toEqual({ kind: 'home' });
    expect(parseRoute('#/op/sendEvent')).toEqual({ kind: 'operation', id: 'sendEvent' });
    expect(parseRoute('#/guide/webhooks')).toEqual({ kind: 'guide', id: 'webhooks' });
    expect(parseRoute('#/changelog')).toEqual({ kind: 'changelog' });
    expect(parseRoute('#/bogus/1').kind).toBe('missing');
  });
});
