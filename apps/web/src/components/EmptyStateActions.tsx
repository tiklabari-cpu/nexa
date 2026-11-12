/**
 * The next step an empty screen offers in a brand-new workspace (NY-11 · tm 473).
 *
 * A workspace that has just signed up has no conversations, no archive, no
 * customers and no chatbot, and every one of those screens used to say so and
 * stop. The screens now point somewhere: the one thing that fills Inbox,
 * Archive, Customers and Reports is a visitor writing in, and a visitor can only
 * write in once the chat widget is on a website — so that is the step offered.
 *
 * The widget step is offered only while it is still undone: the workspace has
 * no website yet (`GET /websites`, the same query and cache key Settings ›
 * Website widgets reads, so adding a site there retires the link everywhere).
 * An empty inbox at three in the morning in a workspace that has been live for a
 * year is not a setup problem, and must not be answered with one. It is offered
 * only to somebody who may open that Settings section; anybody else gets the
 * `fallback`, if the screen names one, or nothing.
 */
import type { ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { visibleSections } from '../features/settings/settings-sections.js';
import { useApiClient, useAuth, useBrand } from '../lib/auth-store.js';
import { useDeployment } from '../lib/deployment.js';
import { useTranslate } from '../lib/i18n.js';
import { AI_AGENT_LINK, isNavVisible } from './navigation.js';

const WIDGET_SECTION = 'website-widgets';
const INSTALL_WIDGET_ROUTE = '/app/settings/website-widgets';

/** The primary-button look the Home checklist's "Set up" links already wear. */
const BUTTON_LINK =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600';
const TEXT_LINK = 'font-medium text-content-brand hover:underline';

/** Whether the caller may open Settings › Website widgets on this deployment. */
function useCanInstallWidget(): boolean {
  const agent = useAuth((s) => s.agent);
  const { pilot_mode: pilotMode } = useDeployment();
  return visibleSections(agent?.scopes ?? [], pilotMode).some(
    (section) => section.slug === WIDGET_SECTION,
  );
}

/**
 * `'install'` while the widget step is undone and the caller can do it,
 * `'done'` once it is done or cannot be theirs, `'pending'` until that is known
 * (nothing is drawn meanwhile, so a link does not flash in and back out).
 */
function useWidgetStep(): 'install' | 'done' | 'pending' {
  const api = useApiClient();
  const { brandId } = useBrand();
  const canInstall = useCanInstallWidget();
  const sites = useQuery({
    queryKey: ['settings', 'websites', brandId],
    queryFn: () => api.get<{ items: unknown[] }>('/websites'),
    enabled: canInstall,
  });
  if (!canInstall) return 'done';
  if (sites.isPending) return 'pending';
  // A failed read offers nothing rather than a step that may already be done.
  if (sites.isError || !Array.isArray(sites.data?.items)) return 'done';
  return sites.data.items.length === 0 ? 'install' : 'done';
}

/**
 * "Install the chat widget" while no website has it yet; otherwise the
 * `fallback` ("Go to the inbox"), when the screen has one worth offering.
 */
export function InstallWidgetAction({ fallback }: { fallback?: 'inbox' }): ReactElement | null {
  const t = useTranslate();
  const step = useWidgetStep();
  if (step === 'install') {
    return (
      <Link to={INSTALL_WIDGET_ROUTE} className={BUTTON_LINK}>
        {t('common.emptyState.installWidget')}
      </Link>
    );
  }
  if (step === 'done' && fallback === 'inbox') {
    return (
      <Link to="/app/inbox" className={BUTTON_LINK}>
        {t('common.emptyState.goToInbox')}
      </Link>
    );
  }
  return null;
}

/**
 * A sentence and the widget link, for a screen that is not itself empty but
 * reads all zeroes until the first visitor writes in (Reports' overview). Drawn
 * only while the widget step is undone.
 */
export function InstallWidgetHint({ text }: { text: string }): ReactElement | null {
  const t = useTranslate();
  if (useWidgetStep() !== 'install') return null;
  return (
    <p className="text-sm text-content-secondary">
      {text}{' '}
      <Link to={INSTALL_WIDGET_ROUTE} className={TEXT_LINK}>
        {t('common.emptyState.installWidget')}
      </Link>
    </p>
  );
}

/** "Create an AI agent" → Playbook › General, for whoever may open the Playbook. */
export function CreateAiAgentAction(): ReactElement | null {
  const t = useTranslate();
  const agent = useAuth((s) => s.agent);
  const { pilot_mode: pilotMode } = useDeployment();
  if (!isNavVisible(AI_AGENT_LINK, agent?.scopes ?? [], pilotMode, agent?.role ?? null)) {
    return null;
  }
  return (
    <Link to={AI_AGENT_LINK.to} className={BUTTON_LINK}>
      {t('common.emptyState.createAiAgent')}
    </Link>
  );
}
