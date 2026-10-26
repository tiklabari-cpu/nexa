import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { DeploymentGate } from './components/DeploymentGate.js';
import { ApiClientError } from './lib/api-client.js';
import { NOTICE_QUERY_KEY } from './lib/notice.js';
// Bundled, not fetched from a font CDN: the panel ships self-hosted and its CSP
// allows no third-party origins. Only the subsets a page uses are downloaded.
import '@fontsource-variable/inter';
import './styles/index.css';

/**
 * A refusal for maintenance (tm 389.13) re-reads the notice at once, so the
 * band or the full-page message appears on the request that met it rather
 * than at the next minute's poll.
 */
function onError(error: unknown): void {
  if (error instanceof ApiClientError && error.type === 'maintenance') {
    void queryClient.invalidateQueries({ queryKey: NOTICE_QUERY_KEY });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 401 or a 404 just burns time and rate limit budget.
      retry: (failureCount, error) =>
        error instanceof ApiClientError ? error.isRetryable && failureCount < 2 : failureCount < 2,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Nothing draws before this deployment's settings are in (tm 259.4). */}
        <DeploymentGate>
          <App />
        </DeploymentGate>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
