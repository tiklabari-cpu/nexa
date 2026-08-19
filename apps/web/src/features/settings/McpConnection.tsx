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
import { useTranslate } from '../../lib/i18n.js';

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

export function McpConnection(): ReactElement {
  const t = useTranslate();
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
      title={t('settings.mcpConnection.title')}
      description={t('settings.mcpConnection.description')}
    >
      {manifest.error ? (
        <ErrorNotice message={t('settings.mcpConnection.loadError')} />
      ) : (
        <Card>
          {manifest.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : (
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.mcpConnection.serverUrlLabel')}
                </span>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    aria-label={t('settings.mcpConnection.serverUrlLabel')}
                    value={manifest.data.server.url}
                    onFocus={(event) => event.target.select()}
                    className="flex-1 rounded-md border border-border bg-inset px-2 py-1.5 font-mono text-sm outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => copy(manifest.data.server.url)}
                    className="shrink-0 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
                  >
                    {copied ? t('settings.copied') : t('settings.copy')}
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
                  {t('settings.mcpConnection.claudeSetup')}
                  <span aria-hidden="true" className="text-content-tertiary">
                    {setupOpen ? '−' : '+'}
                  </span>
                </button>
                {setupOpen && (
                  <ol className="list-inside list-decimal border-t border-border px-3 py-3 text-sm text-content-secondary [&>li]:py-0.5">
                    <li>{t('settings.mcpConnection.step1')}</li>
                    <li>{t('settings.mcpConnection.step2')}</li>
                    <li>{t('settings.mcpConnection.step3')}</li>
                    <li>{t('settings.mcpConnection.step4')}</li>
                    <li>{t('settings.mcpConnection.step5')}</li>
                  </ol>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.mcpConnection.examplePromptLabel')}
                </span>
                <p className="rounded-md border border-border bg-inset px-3 py-2 font-mono text-sm text-content-secondary">
                  “{t('settings.mcpConnection.examplePrompt')}”
                </p>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.mcpConnection.availableToolsLabel')}
                </span>
                {manifest.data.tools.length === 0 ? (
                  <EmptyState
                    title={t('settings.mcpConnection.empty.title')}
                    description={t('settings.mcpConnection.empty.description')}
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
