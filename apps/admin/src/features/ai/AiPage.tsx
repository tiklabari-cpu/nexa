/**
 * The AI page (tm 389.19 · FR-ADMIN-23): what the platform ships for the AI — the locked G1–G19
 * rules, the crisis-text drafts, the iGaming template pack and each workspace's installs, the
 * compliance scenario pack, the QA rubric, the tool catalogue — one tab each.
 *
 * The provider, models, keys and caps are on Settings (389.17); this page is the catalogues.
 * Read-only for every role that can open it, except the crisis-text drafts, which need
 * `ai.manage`. A workspace's content is never here: keys, versions and counts.
 */
import { useState, type ReactElement } from 'react';
import { Page } from '../../components/Page.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  CompliancePanel,
  GuardrailsPanel,
  RubricPanel,
  TemplatesPanel,
  ToolsPanel,
} from './CatalogSections.js';
import { CrisisDraftsSection } from './CrisisDraftsSection.js';

export const AI_TABS = [
  'guardrails',
  'crisis',
  'templates',
  'compliance',
  'rubric',
  'tools',
] as const;
export type AiTab = (typeof AI_TABS)[number];

export function AiPage(): ReactElement {
  const t = useTranslate();
  const [tab, setTab] = useState<AiTab>('guardrails');

  return (
    <Page title={t('nav.ai')} description={t('shell.pages.ai.description')}>
      <div
        role="tablist"
        aria-label={t('ai.tabs.label')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {AI_TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`ai-tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`ai-panel-${name}`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              event.preventDefault();
              const next =
                AI_TABS[(AI_TABS.indexOf(name) + step + AI_TABS.length) % AI_TABS.length]!;
              setTab(next);
              document.getElementById(`ai-tab-${next}`)?.focus();
            }}
            className={`-mb-px inline-block border-b-2 px-3 py-2 text-sm ${
              tab === name
                ? 'border-brand-600 font-medium text-content'
                : 'border-transparent text-content-secondary hover:text-content'
            }`}
          >
            {t(`ai.tabs.${name}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`ai-panel-${tab}`} aria-labelledby={`ai-tab-${tab}`}>
        <TabBody tab={tab} />
      </div>
    </Page>
  );
}

function TabBody({ tab }: { tab: AiTab }): ReactElement {
  switch (tab) {
    case 'guardrails':
      return <GuardrailsPanel />;
    case 'crisis':
      return <CrisisDraftsSection />;
    case 'templates':
      return <TemplatesPanel />;
    case 'compliance':
      return <CompliancePanel />;
    case 'rubric':
      return <RubricPanel />;
    case 'tools':
      return <ToolsPanel />;
  }
}
