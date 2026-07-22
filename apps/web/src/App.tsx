import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { apiClient } from './lib/api-client.js';

interface Health {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  region: string;
  dependencies: Record<string, { status: 'up' | 'down' }>;
}

/**
 * Slice 1 placeholder. The real shell — icon rail, module sidebar, 3-pane inbox
 * and right panel — arrives in slice 7, on top of the tokens defined here.
 */
function SystemStatus(): ReactElement {
  const { data, isPending, error } = useQuery({
    queryKey: ['health'],
    queryFn: () => apiClient.get<Health>('/health'),
    refetchInterval: 15_000,
  });

  return (
    <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 p-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Nexa</h1>
        <p className="text-content-secondary">Live support + AI customer service platform</p>
      </header>

      <section
        aria-labelledby="system-status-heading"
        className="rounded-lg border border-border bg-surface p-5 shadow-xs"
      >
        <h2 id="system-status-heading" className="mb-3 text-lg font-semibold">
          System status
        </h2>

        {isPending ? (
          <p className="text-content-secondary" role="status">
            Checking services…
          </p>
        ) : error ? (
          <p className="text-danger" role="status">
            API unreachable — is <code className="font-mono">make dev</code> running?
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-content-secondary">API</dt>
            <dd>
              <StatusPill up={data.status === 'ok'} label={data.status} />{' '}
              <span className="tabular">v{data.version}</span> · {data.region}
            </dd>
            {Object.entries(data.dependencies).map(([name, dependency]) => (
              <DependencyRow key={name} name={name} up={dependency.status === 'up'} />
            ))}
          </dl>
        )}
      </section>
    </main>
  );
}

function DependencyRow({ name, up }: { name: string; up: boolean }): ReactElement {
  return (
    <>
      <dt className="capitalize text-content-secondary">{name}</dt>
      <dd>
        <StatusPill up={up} label={up ? 'up' : 'down'} />
      </dd>
    </>
  );
}

/** Status is conveyed by glyph + text as well as colour (design-brief §7). */
function StatusPill({ up, label }: { up: boolean; label: string }): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        up ? 'text-success' : 'text-danger'
      }`}
    >
      <span aria-hidden="true">{up ? '●' : '○'}</span>
      {label}
    </span>
  );
}

export function App(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<SystemStatus />} />
      <Route path="*" element={<SystemStatus />} />
    </Routes>
  );
}
