/**
 * Entry point of the public API documentation page (KN-04 · tm 376), served at
 * `/developers/docs/` without a sign-in.
 *
 * Fetches the published OpenAPI document that sits beside the page, builds the
 * model and renders the view the address names. Routing is the URL hash, so every
 * operation has an address that survives a reload and can be sent in a message.
 */
import './docs.css';
import {
  parseRoute,
  renderNavigation,
  renderRoute,
  renderSearchResults,
  type Route,
} from './render.js';
import { buildModel, searchOperations, type Model, type Spec } from './spec.js';

const SPEC_URL = '/developers/docs/openapi.json';

function mount(doc: Document, model: Model): void {
  const nav = doc.getElementById('nav');
  const main = doc.getElementById('main');
  const search = doc.getElementById('search') as HTMLInputElement | null;
  const version = doc.getElementById('version');
  if (!nav || !main || !search) throw new Error('The documentation page is missing its shell');
  if (version) version.textContent = `v${model.spec.info.version}`;

  let route: Route = parseRoute(location.hash);

  const draw = (): void => {
    const query = search.value.trim();
    const results = query ? searchOperations(model, query) : null;
    const matches = results ? new Set(results.map((entry) => entry.id)) : null;

    nav.replaceChildren(renderNavigation(doc, model, matches, route));
    main.replaceChildren(
      results && route.kind !== 'operation'
        ? renderSearchResults(doc, results, query)
        : renderRoute(doc, model, route),
    );
    doc.title = `${model.spec.info.title} — API documentation`;
    main.focus({ preventScroll: true });
  };

  window.addEventListener('hashchange', () => {
    route = parseRoute(location.hash);
    // Opening an operation from the results keeps the filter; anything else clears it.
    if (route.kind !== 'operation') search.value = '';
    draw();
    window.scrollTo(0, 0);
  });
  search.addEventListener('input', () => {
    if (search.value.trim() && route.kind !== 'home') {
      // A search is looked for on the overview, not on top of an open operation.
      history.replaceState(null, '', '#/');
      route = { kind: 'home' };
    }
    draw();
  });
  doc.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      doc.activeElement !== search &&
      !(doc.activeElement instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      search.focus();
    }
  });
  draw();
}

async function boot(): Promise<void> {
  const status = document.getElementById('main');
  try {
    const response = await fetch(SPEC_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mount(document, buildModel((await response.json()) as Spec));
  } catch (error) {
    if (status) {
      status.textContent = `The documentation could not be loaded (${error instanceof Error ? error.message : 'error'}). Reload the page to try again.`;
    }
  }
}

void boot();
