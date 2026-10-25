/**
 * Rendering the whole admin app against a fake platform API (tm 389.6).
 *
 * The session lives in module-level state (`lib/auth-store.ts`: a token in `sessionStorage`,
 * a zustand store), so `resetSession()` is the `afterEach` every suite that renders `<App />`
 * needs — a token left behind would make the next file "reload" into the previous one's session.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, type RenderResult } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { App } from '../App.js';
import { SESSION_STORAGE_KEY, useAuth } from '../lib/auth-store.js';
import { resetLocale } from './i18n.js';
import {
  createFakePlatform,
  type FakePlatform,
  type FakePlatformOptions,
} from './fake-platform.js';

export function installFakePlatform(options?: FakePlatformOptions): FakePlatform {
  const fake = createFakePlatform(options);
  vi.stubGlobal('fetch', fake.fetch);
  return fake;
}

export function renderApp(path = '/', options: { strict?: boolean } = {}): RenderResult {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/** Back to a fresh tab: no token, no operator, the store waiting for its first `restore()`. */
export async function resetSession(): Promise<void> {
  await act(async () => {
    await useAuth.getState().signOut();
  });
  act(() => {
    useAuth.setState({ status: 'unknown', sessionEnded: false });
  });
  globalThis.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  globalThis.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  resetLocale();
}
