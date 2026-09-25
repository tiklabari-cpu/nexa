/**
 * Where the widget sends its REST calls (tm 255.15).
 *
 * The api is on another origin and the loader forwards no address to the
 * iframe, so before this the only answer was a hard-coded
 * `http://localhost:4000/api/v1` — right for the demo stack, and for a real
 * deployment the visitor's own machine. The pilot image bakes its public
 * address in at build time (`VITE_API_BASE_URL`, apps/widget/Dockerfile);
 * `?api=` still wins for local dev.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from './widget.js';

let calls: string[] = [];

function mountWidget(query: string): HTMLElement {
  window.history.replaceState({}, '', `/widget.html?organization_id=org-1${query}`);
  const root = document.createElement('div');
  root.id = 'siyahtus-widget-root';
  document.body.append(root);
  mount(document, window);
  return root;
}

async function firstCallAfterOpening(root: HTMLElement): Promise<string> {
  root.querySelector<HTMLButtonElement>('.nx-launcher')!.click();
  for (let i = 0; i < 50 && calls.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(calls.length, 'opening the widget made no request').toBeGreaterThan(0);
  return calls[0]!;
}

beforeEach(() => {
  calls = [];
  document.head.replaceChildren();
  document.body.replaceChildren();
  window.localStorage.clear();
  // Every request here answers 503, so the widget reports a failed connect —
  // expected, and not what these tests are about.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the widget API base address', () => {
  it('uses the address baked in at build time', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.pilot.example/api/v1');

    const url = await firstCallAfterOpening(mountWidget(''));

    expect(url.startsWith('https://api.pilot.example/api/v1/customer/token')).toBe(true);
  });

  it('falls back to the demo stack api when nothing was baked in', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '');

    const url = await firstCallAfterOpening(mountWidget(''));

    expect(url.startsWith('http://localhost:4000/api/v1/customer/token')).toBe(true);
  });

  it('lets ?api= override the baked address', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.pilot.example/api/v1');

    const url = await firstCallAfterOpening(
      mountWidget(`&api=${encodeURIComponent('http://127.0.0.1:14000/api/v1')}`),
    );

    expect(url.startsWith('http://127.0.0.1:14000/api/v1/customer/token')).toBe(true);
  });
});
