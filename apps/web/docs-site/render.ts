/**
 * The documentation viewer's views (KN-04 · tm 376).
 *
 * Every function takes the model and returns DOM; none reads the network, the
 * location or storage, so the views are testable in jsdom. All text enters the page
 * through `textContent`, and the markup carries no inline script or style — the
 * page is served under the panel's strict Content-Security-Policy.
 */
import { renderInline, renderMarkdown } from './markdown.js';
import {
  baseUrlOf,
  curlExample,
  exampleValue,
  resolveRef,
  schemaRows,
  type Model,
  type Operation,
  type OperationEntry,
  type Parameter,
  type Response,
  type Schema,
  type SchemaRow,
} from './spec.js';

export type Route =
  | { kind: 'home' }
  | { kind: 'guide'; id: string }
  | { kind: 'operation'; id: string }
  | { kind: 'changelog' }
  | { kind: 'missing'; hash: string };

/** `#/op/getChat` → `{ kind: 'operation', id: 'getChat' }`; unknown shapes are `missing`. */
export function parseRoute(hash: string): Route {
  const cleaned = hash.replace(/^#\/?/, '');
  if (cleaned === '') return { kind: 'home' };
  const [head, ...rest] = cleaned.split('/');
  const tail = decodeURIComponent(rest.join('/'));
  if (head === 'guide' && tail) return { kind: 'guide', id: tail };
  if (head === 'op' && tail) return { kind: 'operation', id: tail };
  if (head === 'changelog') return { kind: 'changelog' };
  return { kind: 'missing', hash };
}

export const routeHash = {
  guide: (id: string): string => `#/guide/${encodeURIComponent(id)}`,
  operation: (id: string): string => `#/op/${encodeURIComponent(id)}`,
  changelog: (): string => '#/changelog',
  home: (): string => '#/',
};

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function link(doc: Document, href: string, text: string, className?: string): HTMLAnchorElement {
  const a = el(doc, 'a', className, text);
  a.setAttribute('href', href);
  return a;
}

export function methodBadge(doc: Document, method: string): HTMLElement {
  const badge = el(doc, 'span', `method method-${method}`, method.toUpperCase());
  return badge;
}

/** The sidebar's list of operations, grouped by tag (all of them, or only `matches`). */
export function renderOperationList(
  doc: Document,
  model: Model,
  matches: ReadonlySet<string> | null,
  activeId: string | null,
): HTMLElement {
  const root = el(doc, 'div', 'op-list');
  for (const group of model.groups) {
    const shown = group.operations.filter((entry) => matches === null || matches.has(entry.id));
    if (shown.length === 0) continue;
    const section = el(doc, 'section', 'op-group');
    section.appendChild(el(doc, 'h3', undefined, group.name));
    const list = el(doc, 'ul');
    for (const entry of shown) {
      const item = el(doc, 'li');
      const anchor = link(doc, routeHash.operation(entry.id), '', 'op-link');
      anchor.dataset['operation'] = entry.id;
      if (entry.id === activeId) anchor.setAttribute('aria-current', 'page');
      anchor.appendChild(methodBadge(doc, entry.method));
      anchor.appendChild(el(doc, 'span', 'op-name', entry.operation.summary ?? entry.id));
      item.appendChild(anchor);
      list.appendChild(item);
    }
    section.appendChild(list);
    root.appendChild(section);
  }
  return root;
}

export function renderSearchResults(
  doc: Document,
  results: OperationEntry[],
  query: string,
): HTMLElement {
  const root = el(doc, 'div', 'search-results');
  root.appendChild(el(doc, 'h2', undefined, `Search: ${query}`));
  root.appendChild(
    el(
      doc,
      'p',
      'muted',
      results.length === 0 ? 'No operation matches.' : `${results.length} operation(s)`,
    ),
  );
  const list = el(doc, 'ul', 'result-list');
  for (const entry of results) {
    const item = el(doc, 'li');
    const anchor = link(doc, routeHash.operation(entry.id), '', 'result');
    anchor.appendChild(methodBadge(doc, entry.method));
    anchor.appendChild(el(doc, 'code', undefined, entry.path));
    anchor.appendChild(el(doc, 'span', 'result-summary', entry.operation.summary ?? ''));
    item.appendChild(anchor);
    list.appendChild(item);
  }
  root.appendChild(list);
  return root;
}

function schemaTable(doc: Document, rows: SchemaRow[]): HTMLElement {
  const wrap = el(doc, 'div', 'table-wrap');
  const table = el(doc, 'table', 'schema-table');
  const head = el(doc, 'tr');
  for (const title of ['Field', 'Type', 'Description'])
    head.appendChild(el(doc, 'th', undefined, title));
  table.appendChild(el(doc, 'thead')).appendChild(head);
  const body = el(doc, 'tbody');
  for (const row of rows) {
    const tr = el(doc, 'tr');
    const nameCell = el(doc, 'td', 'field');
    // Depth is shown by the dotted name; the indent is a class, not an inline style.
    nameCell.classList.add(`depth-${Math.min(row.depth, 5)}`);
    nameCell.appendChild(el(doc, 'code', undefined, row.name));
    if (row.required) nameCell.appendChild(el(doc, 'span', 'required', 'required'));
    tr.appendChild(nameCell);

    const typeCell = el(doc, 'td', 'type', row.type);
    for (const note of row.constraints) typeCell.appendChild(el(doc, 'span', 'constraint', note));
    tr.appendChild(typeCell);

    const description = el(doc, 'td', 'description');
    if (row.description) description.appendChild(renderMarkdown(doc, row.description));
    if (row.values.length > 0) {
      const values = el(doc, 'p', 'values', 'One of: ');
      row.values.slice(0, 40).forEach((value, index) => {
        if (index > 0) values.appendChild(doc.createTextNode(', '));
        values.appendChild(el(doc, 'code', undefined, value));
      });
      if (row.values.length > 40)
        values.appendChild(doc.createTextNode(` … and ${row.values.length - 40} more`));
      description.appendChild(values);
    }
    tr.appendChild(description);
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function parametersTable(doc: Document, model: Model, parameters: Parameter[]): HTMLElement | null {
  if (parameters.length === 0) return null;
  const wrap = el(doc, 'div', 'table-wrap');
  const table = el(doc, 'table', 'schema-table');
  const head = el(doc, 'tr');
  for (const title of ['Name', 'In', 'Type', 'Description'])
    head.appendChild(el(doc, 'th', undefined, title));
  table.appendChild(el(doc, 'thead')).appendChild(head);
  const body = el(doc, 'tbody');
  for (const raw of parameters) {
    const parameter = resolveRef(model.spec, raw);
    const tr = el(doc, 'tr');
    const nameCell = el(doc, 'td', 'field');
    nameCell.appendChild(el(doc, 'code', undefined, parameter.name));
    if (parameter.required) nameCell.appendChild(el(doc, 'span', 'required', 'required'));
    tr.appendChild(nameCell);
    tr.appendChild(el(doc, 'td', undefined, parameter.in));
    const schema = parameter.schema ? resolveRef(model.spec, parameter.schema) : undefined;
    const type = schema
      ? Array.isArray(schema.type)
        ? schema.type.join(' | ')
        : (schema.type ?? 'any')
      : 'any';
    const typeCell = el(doc, 'td', 'type', schema?.enum ? 'enum' : type);
    tr.appendChild(typeCell);
    const description = el(doc, 'td', 'description');
    if (parameter.description) description.appendChild(renderMarkdown(doc, parameter.description));
    if (schema?.enum) {
      const values = el(doc, 'p', 'values', 'One of: ');
      schema.enum.forEach((value, index) => {
        if (index > 0) values.appendChild(doc.createTextNode(', '));
        values.appendChild(el(doc, 'code', undefined, String(value)));
      });
      description.appendChild(values);
    }
    tr.appendChild(description);
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  return wrap;
}

function codeBlock(doc: Document, text: string, lang: string): HTMLElement {
  const pre = el(doc, 'pre', 'code-block');
  pre.dataset['lang'] = lang;
  pre.appendChild(el(doc, 'code', undefined, text));
  return pre;
}

function responseBlock(doc: Document, model: Model, status: string, raw: Response): HTMLElement {
  const response = resolveRef(model.spec, raw);
  const details = el(doc, 'details', 'response');
  details.dataset['status'] = status;
  if (/^2/.test(status)) details.open = true;
  const summary = el(doc, 'summary');
  summary.appendChild(el(doc, 'span', `status status-${status[0]}xx`, status));
  summary.appendChild(el(doc, 'span', 'status-text', response.description ?? ''));
  details.appendChild(summary);

  const media = response.content?.['application/json'];
  if (media?.schema) {
    details.appendChild(schemaTable(doc, schemaRows(model.spec, media.schema, 'response')));
    if (/^2/.test(status)) {
      details.appendChild(
        codeBlock(
          doc,
          JSON.stringify(media.example ?? exampleValue(model.spec, media.schema), null, 2),
          'json',
        ),
      );
    }
  } else if (response.content) {
    details.appendChild(el(doc, 'p', 'muted', Object.keys(response.content).join(', ')));
  }
  const headers = Object.entries(response.headers ?? {});
  if (headers.length > 0) {
    const list = el(doc, 'ul', 'headers');
    for (const [name, header] of headers) {
      const item = el(doc, 'li');
      item.appendChild(el(doc, 'code', undefined, name));
      if (header.description) item.appendChild(doc.createTextNode(` — ${header.description}`));
      list.appendChild(item);
    }
    details.appendChild(list);
  }
  return details;
}

export function renderOperation(doc: Document, model: Model, entry: OperationEntry): HTMLElement {
  const operation: Operation = entry.operation;
  const root = el(doc, 'article', 'operation');
  root.dataset['operation'] = entry.id;

  root.appendChild(el(doc, 'p', 'eyebrow', entry.tag));
  root.appendChild(el(doc, 'h1', undefined, operation.summary ?? entry.id));
  const signature = el(doc, 'p', 'signature');
  signature.appendChild(methodBadge(doc, entry.method));
  signature.appendChild(el(doc, 'code', undefined, entry.path));
  root.appendChild(signature);

  const anonymous = Array.isArray(operation.security) && operation.security.length === 0;
  const authNote = el(doc, 'p', 'auth-note');
  if (anonymous) {
    authNote.textContent = 'No credential needed.';
  } else {
    authNote.appendChild(doc.createTextNode('Needs a credential — see '));
    authNote.appendChild(link(doc, routeHash.guide('authentication'), 'Authentication'));
    authNote.appendChild(doc.createTextNode('.'));
  }
  root.appendChild(authNote);

  if (operation.description) root.appendChild(renderMarkdown(doc, operation.description, 1));

  const parameters = [...entry.pathParameters, ...(operation.parameters ?? [])];
  const table = parametersTable(doc, model, parameters);
  if (table) {
    root.appendChild(el(doc, 'h2', undefined, 'Parameters'));
    root.appendChild(table);
  }

  const body = operation.requestBody ? resolveRef(model.spec, operation.requestBody) : undefined;
  const json = body?.content?.['application/json'];
  if (json?.schema) {
    root.appendChild(el(doc, 'h2', undefined, 'Request body'));
    if (body?.description) root.appendChild(renderMarkdown(doc, body.description));
    root.appendChild(schemaTable(doc, schemaRows(model.spec, json.schema as Schema, 'body')));
  }

  root.appendChild(el(doc, 'h2', undefined, 'Example'));
  root.appendChild(
    codeBlock(doc, curlExample(model, entry, { baseUrl: baseUrlOf(model.spec) }), 'bash'),
  );

  root.appendChild(el(doc, 'h2', undefined, 'Responses'));
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    root.appendChild(responseBlock(doc, model, status, response));
  }
  return root;
}

export function renderGuide(doc: Document, model: Model, id: string): HTMLElement {
  const guide = model.spec['x-guides']?.find((entry) => entry.id === id);
  const root = el(doc, 'article', 'guide');
  if (!guide) {
    root.appendChild(el(doc, 'h1', undefined, 'Guide not found'));
    return root;
  }
  root.dataset['guide'] = guide.id;
  root.appendChild(el(doc, 'h1', undefined, guide.title));
  // A guide's `###` sections are the page's second level under its title.
  root.appendChild(renderMarkdown(doc, guide.markdown, -1));
  return root;
}

export function renderChangelog(doc: Document, model: Model): HTMLElement {
  const root = el(doc, 'article', 'changelog');
  root.appendChild(el(doc, 'h1', undefined, 'Changelog'));
  for (const entry of model.spec['x-changelog'] ?? []) {
    const section = el(doc, 'section', 'release');
    section.dataset['version'] = entry.version;
    const heading = el(doc, 'h2', undefined, `Version ${entry.version}`);
    heading.appendChild(el(doc, 'span', 'muted', ` · ${entry.date}`));
    section.appendChild(heading);
    const summary = el(doc, 'p');
    renderInline(doc, entry.summary, summary);
    section.appendChild(summary);
    const list = el(doc, 'ul');
    for (const change of entry.changes) {
      const item = el(doc, 'li');
      renderInline(doc, change, item);
      list.appendChild(item);
    }
    section.appendChild(list);
    root.appendChild(section);
  }
  return root;
}

export function renderHome(doc: Document, model: Model): HTMLElement {
  const { spec } = model;
  const root = el(doc, 'article', 'home');
  root.appendChild(el(doc, 'h1', undefined, spec.info.title));
  const version = el(doc, 'p', 'muted');
  version.appendChild(doc.createTextNode(`Version ${spec.info.version} · `));
  version.appendChild(link(doc, routeHash.changelog(), 'Changelog'));
  version.appendChild(doc.createTextNode(` · ${model.operations.length} operations`));
  root.appendChild(version);
  if (spec.info.description) root.appendChild(renderMarkdown(doc, spec.info.description));

  const base = el(doc, 'p');
  base.appendChild(doc.createTextNode('Base URL: '));
  base.appendChild(el(doc, 'code', undefined, baseUrlOf(spec)));
  root.appendChild(base);

  root.appendChild(el(doc, 'h2', undefined, 'Start here'));
  const guides = el(doc, 'ul');
  for (const guide of spec['x-guides'] ?? []) {
    const item = el(doc, 'li');
    item.appendChild(link(doc, routeHash.guide(guide.id), guide.title));
    guides.appendChild(item);
  }
  root.appendChild(guides);

  root.appendChild(el(doc, 'h2', undefined, 'Reference'));
  const tags = el(doc, 'ul');
  for (const group of model.groups) {
    const item = el(doc, 'li');
    item.appendChild(link(doc, routeHash.operation(group.operations[0]!.id), group.name));
    item.appendChild(doc.createTextNode(` — ${group.operations.length}`));
    if (group.description) item.appendChild(el(doc, 'span', 'muted', ` · ${group.description}`));
    tags.appendChild(item);
  }
  root.appendChild(tags);
  return root;
}

export function renderRoute(doc: Document, model: Model, route: Route): HTMLElement {
  switch (route.kind) {
    case 'home':
      return renderHome(doc, model);
    case 'guide':
      return renderGuide(doc, model, route.id);
    case 'changelog':
      return renderChangelog(doc, model);
    case 'operation': {
      const entry = model.byId.get(route.id);
      if (entry) return renderOperation(doc, model, entry);
      break;
    }
    case 'missing':
      break;
  }
  const missing = el(doc, 'article', 'missing');
  missing.appendChild(el(doc, 'h1', undefined, 'Not found'));
  missing.appendChild(link(doc, routeHash.home(), 'Back to the overview'));
  return missing;
}

/** The sidebar's navigation: guides, changelog and (filtered) operations. */
export function renderNavigation(
  doc: Document,
  model: Model,
  matches: ReadonlySet<string> | null,
  route: Route,
): HTMLElement {
  const nav = el(doc, 'div', 'nav-body');
  const active = route.kind === 'operation' ? route.id : null;
  if (matches === null) {
    nav.appendChild(el(doc, 'h2', undefined, 'Guides'));
    const list = el(doc, 'ul');
    for (const guide of model.spec['x-guides'] ?? []) {
      const item = el(doc, 'li');
      const anchor = link(doc, routeHash.guide(guide.id), guide.title, 'guide-link');
      if (route.kind === 'guide' && route.id === guide.id)
        anchor.setAttribute('aria-current', 'page');
      item.appendChild(anchor);
      list.appendChild(item);
    }
    const changelog = el(doc, 'li');
    const changelogLink = link(doc, routeHash.changelog(), 'Changelog', 'guide-link');
    if (route.kind === 'changelog') changelogLink.setAttribute('aria-current', 'page');
    changelog.appendChild(changelogLink);
    list.appendChild(changelog);
    nav.appendChild(list);
    nav.appendChild(el(doc, 'h2', undefined, 'Reference'));
  }
  nav.appendChild(renderOperationList(doc, model, matches, active));
  return nav;
}
