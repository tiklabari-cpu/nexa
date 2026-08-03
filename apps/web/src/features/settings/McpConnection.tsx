/**
 * Settings → MCP server (FR-MOD-08.8.3, rapor-1 §Integrations). Where an admin
 * points an external MCP client — Claude, ChatGPT, or anything else that
 * speaks the protocol — at this workspace's tool surface.
 *
 * The manifest (08.8.3-b, `GET /mcp/manifest`) is the single source for the
 * server URL, protocol version and tool catalogue; this screen only displays
 * what it returns. It mints or shows no credential of its own — connecting a
 * client still goes through the existing PAT surface, so there is nothing
 * secret in this DOM for a screenshot or a shared screen to leak.
 */
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { useApiClient } from '../../lib/auth-store.js';

interface McpToolDescriptor {
  name: string;
  title: string;
  description: string;
  required_scopes: string[];
}

interface McpManifest {
  protocol_version: string;
  server: { name: string; url: string; version: string };
  tools: McpToolDescriptor[];
}

/** rapor-1 §Integrations — the sample question shown beside the connection details. */
const EXAMPLE_PROMPT = 'Find all tickets where customers ask about bulk orders';

export function McpConnection(): ReactElement {
  const api = useApiClient();
  const [copied, setCopied] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const manifest = useQuery({
    queryKey: ['settings', 'mcp-manifest'],
    queryFn: () => api.get<McpManifest>('/mcp/manifest'),
    // The catalogue is a static, license-independent document (08.8.3-b) — no
    // reason to refetch it as often as a settings list that admins edit.
    staleTime: 60_000,
  });

  function copy(url: string): void {
    void navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1_500);
      },
      () => setCopied(false),
    );
  }

  return (
    <Section
      title="MCP server"
      description="Ask AI assistants about your Nexa data. Works with Claude, ChatGPT, and any MCP-compatible tool."
    >
      {manifest.error ? (
        <ErrorNotice message="Could not load the MCP server details." />
      ) : (
        <Card>
          {manifest.isPending ? (
            <p className="p-4 text-sm text-content-secondary">Loading…</p>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  MCP server URL
                </span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    aria-label="MCP server URL"
                    value={manifest.data.server.url}
                    onFocus={(event) => event.target.select()}
                    className="flex-1 rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copy(manifest.data.server.url)}
                    className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="rounded-md border border-border">
                <button
                  type="button"
                  aria-expanded={setupOpen}
                  onClick={() => setSetupOpen((open) => !open)}
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
                >
                  Claude setup
                  <span aria-hidden="true" className="text-content-tertiary">
                    {setupOpen ? '−' : '+'}
                  </span>
                </button>
                {setupOpen && (
                  <ol className="list-inside list-decimal border-t border-border px-3 py-3 text-sm text-content-secondary [&>li]:py-0.5">
                    <li>Open Claude, then go to Settings → Connectors.</li>
                    <li>Choose “Add custom connector”.</li>
                    <li>Paste the MCP server URL above.</li>
                    <li>
                      Sign in with your Nexa account when prompted, and approve the scopes it
                      requests.
                    </li>
                    <li>Ask a question about your workspace — see the example below.</li>
                  </ol>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Example prompt
                </span>
                <p className="rounded-md border border-border bg-inset px-3 py-2 font-mono text-sm text-content-secondary">
                  “{EXAMPLE_PROMPT}”
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  Available tools
                </span>
                {manifest.data.tools.length === 0 ? (
                  <EmptyState
                    title="No tools published yet"
                    description="Tools appear here as they are connected to this server."
                  />
                ) : (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {manifest.data.tools.map((tool) => (
                      <li key={tool.name} className="flex flex-col gap-0.5 px-3 py-2">
                        <span className="font-mono text-sm">{tool.name}</span>
                        <span className="text-2xs text-content-tertiary">{tool.description}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}
