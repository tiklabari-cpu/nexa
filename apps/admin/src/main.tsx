import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.js';
import { ApiClientError } from './lib/api-client.js';
// Bundled, not fetched from a font CDN: the panel ships self-hosted and its CSP allows no
// third-party origins.
import '@fontsource-variable/inter';
import './styles/index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retrying a 401, a 403 or a 404 just burns time and rate-limit budget.
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
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
