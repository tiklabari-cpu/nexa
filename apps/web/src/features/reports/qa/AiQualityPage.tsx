/**
 * Raporlar › AI Kalite (tm 319.3 · SiyahTuş analysis AI-24) —
 * `/app/reports/ai-quality`: the QA queue and the monthly calibration round,
 * a tab each (`?view=calibration`). One review opens at
 * `/app/reports/ai-quality/<id>` (`QaReview`).
 *
 * A Team Lead reaches it without the reports scope — the queue is theirs by
 * the `ai.qa.review` matrix row, not by `reports_read` — so the Reports rail
 * door is open to the role (`navigation.ts` `orRole`) and `ReportsPage`
 * sends a lead without the scope here. Below Team Lead nothing is drawn: the
 * routes would refuse every read.
 */
import type { ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../../components/EmptyState.js';
import { Card, Page } from '../../../components/Page.js';
import { useAuth } from '../../../lib/auth-store.js';
import { useTranslate } from '../../../lib/i18n.js';
import { roleAtLeast } from '../../team/RoleMenu.js';
import { QaCalibration } from './QaCalibration.js';
import { QaQueue } from './QaQueue.js';

const VIEWS = ['queue', 'calibration'] as const;
type QaView = (typeof VIEWS)[number];

export function AiQualityPage(): ReactElement {
  const t = useTranslate();
  const role = useAuth((s) => s.agent?.role ?? null);
  const readsReports = useAuth((s) => s.agent?.scopes.includes('reports_read') ?? false);
  const [params, setParams] = useSearchParams();
  const view: QaView = params.get('view') === 'calibration' ? 'calibration' : 'queue';

  const reviews = roleAtLeast(role, 'team_lead');

  return (
    <Page
      title={t('reports.qa.page.title')}
      description={t('reports.qa.page.description')}
      actions={
        readsReports ? (
          <Link
            to="/app/reports"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary hover:bg-surface-2"
          >
            {t('reports.qa.page.allReports')}
          </Link>
        ) : undefined
      }
    >
      {!reviews ? (
        <Card>
          <EmptyState
            title={t('reports.qa.page.notForRoleTitle')}
            description={t('reports.qa.page.notForRoleDescription')}
          />
        </Card>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t('reports.qa.page.title')}
            className="flex gap-1 border-b border-border"
          >
            {VIEWS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`qa-tab-${id}`}
                aria-selected={view === id}
                aria-controls={`qa-panel-${id}`}
                onClick={() => setParams(id === 'queue' ? {} : { view: id }, { replace: true })}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === id
                    ? 'border-brand-500 text-content'
                    : 'border-transparent text-content-secondary hover:text-content'
                }`}
              >
                {t(`reports.qa.tabs.${id}`)}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`qa-panel-${view}`} aria-labelledby={`qa-tab-${view}`}>
            {view === 'queue' ? <QaQueue /> : <QaCalibration />}
          </div>
        </>
      )}
    </Page>
  );
}
