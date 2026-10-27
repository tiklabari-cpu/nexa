/**
 * How far a website source is crawled (tm 312.4 · AI-17) — the part of the
 * "Add source" form that appears for the Website type.
 *
 * - **Scope** — one page, everything under the address (sitemap or links), or
 *   only what the site's sitemap lists. The default is one page: the choice
 *   that fetches least is the one an admin gets by not choosing.
 * - **Page limit, include and exclude paths** — hidden for one page, which has
 *   no "below it" to bound.
 * - **Automatic refresh** — optional, set right after the source is created.
 * - **Authorisation** — the legal gate: the admin says they may crawl the
 *   site. The Add button stays off until it is ticked; the server cannot know
 *   whose site it is, so the sentence is the panel's to ask.
 *
 * Sibling labels throughout, not wrappers: help text inside a `<label>` folds
 * into the control's accessible name.
 */
import type { ReactElement } from 'react';
import { CRAWL_SCOPES, KNOWLEDGE_CRAWL_LIMITS, KNOWLEDGE_PAGE_LIMIT } from '@siyahtus/types';
import { FieldError } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  CRAWL_REFRESH_DAYS,
  crawlErrors,
  isCrawlScopeValue,
  type CrawlFormValue,
} from './knowledge-crawl.js';

const INPUT =
  'rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none placeholder:text-content-tertiary';
const LABEL = 'text-2xs font-medium uppercase tracking-wide text-content-tertiary';
const HELP = 'text-2xs text-content-tertiary';

export function KnowledgeCrawlFields({
  idPrefix,
  value,
  onChange,
}: {
  idPrefix: string;
  value: CrawlFormValue;
  onChange: (next: CrawlFormValue) => void;
}): ReactElement {
  const t = useTranslate();
  const errors = crawlErrors(value);
  const bounded = value.scope !== 'single';
  const set = (patch: Partial<CrawlFormValue>) => onChange({ ...value, ...patch });

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
      <legend className={`px-1 ${LABEL}`}>{t('playbook.knowledge.crawl.legend')}</legend>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-crawl-scope`} className={LABEL}>
          {t('playbook.knowledge.crawl.scope')}
        </label>
        <select
          id={`${idPrefix}-crawl-scope`}
          value={value.scope}
          onChange={(event) => {
            if (isCrawlScopeValue(event.target.value)) set({ scope: event.target.value });
          }}
          aria-describedby={`${idPrefix}-crawl-scope-help`}
          className={INPUT}
        >
          {CRAWL_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {t(`playbook.knowledge.crawl.scope.${scope}`)}
            </option>
          ))}
        </select>
        <span id={`${idPrefix}-crawl-scope-help`} className={HELP}>
          {t(`playbook.knowledge.crawl.scope.${value.scope}Help`, {
            depth: KNOWLEDGE_CRAWL_LIMITS.depth,
          })}
        </span>
      </div>

      {bounded && (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${idPrefix}-crawl-limit`} className={LABEL}>
              {t('playbook.knowledge.crawl.pageLimit')}
            </label>
            <input
              id={`${idPrefix}-crawl-limit`}
              type="number"
              inputMode="numeric"
              min={KNOWLEDGE_PAGE_LIMIT.min}
              max={KNOWLEDGE_PAGE_LIMIT.max}
              value={value.pageLimit}
              onChange={(event) => set({ pageLimit: event.target.value })}
              aria-invalid={errors.includes('pageLimit') ? true : undefined}
              aria-describedby={`${idPrefix}-crawl-limit-help`}
              className={INPUT}
            />
            <span id={`${idPrefix}-crawl-limit-help`} className={HELP}>
              {t('playbook.knowledge.crawl.pageLimitHelp', {
                max: KNOWLEDGE_PAGE_LIMIT.max,
                workspace: KNOWLEDGE_CRAWL_LIMITS.pagesPerWorkspace,
              })}
            </span>
            <FieldError
              id={`${idPrefix}-crawl-limit-error`}
              message={
                errors.includes('pageLimit')
                  ? t('playbook.knowledge.crawl.pageLimitError', {
                      min: KNOWLEDGE_PAGE_LIMIT.min,
                      max: KNOWLEDGE_PAGE_LIMIT.max,
                    })
                  : null
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <PathsField
              id={`${idPrefix}-crawl-include`}
              label={t('playbook.knowledge.crawl.include')}
              help={t('playbook.knowledge.crawl.includeHelp')}
              invalid={errors.includes('includePaths')}
              value={value.includePaths}
              onChange={(includePaths) => set({ includePaths })}
            />
            <PathsField
              id={`${idPrefix}-crawl-exclude`}
              label={t('playbook.knowledge.crawl.exclude')}
              help={t('playbook.knowledge.crawl.excludeHelp')}
              invalid={errors.includes('excludePaths')}
              value={value.excludePaths}
              onChange={(excludePaths) => set({ excludePaths })}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-crawl-refresh`} className={LABEL}>
          {t('playbook.knowledge.crawl.refresh')}
        </label>
        <input
          id={`${idPrefix}-crawl-refresh`}
          type="number"
          inputMode="numeric"
          min={CRAWL_REFRESH_DAYS.min}
          max={CRAWL_REFRESH_DAYS.max}
          value={value.refreshDays}
          onChange={(event) => set({ refreshDays: event.target.value })}
          aria-invalid={errors.includes('refreshDays') ? true : undefined}
          aria-describedby={`${idPrefix}-crawl-refresh-help`}
          className={INPUT}
        />
        <span id={`${idPrefix}-crawl-refresh-help`} className={HELP}>
          {t('playbook.knowledge.crawl.refreshHelp', {
            min: CRAWL_REFRESH_DAYS.min,
            max: CRAWL_REFRESH_DAYS.max,
          })}
        </span>
        <FieldError
          id={`${idPrefix}-crawl-refresh-error`}
          message={
            errors.includes('refreshDays')
              ? t('playbook.knowledge.crawl.refreshError', {
                  min: CRAWL_REFRESH_DAYS.min,
                  max: CRAWL_REFRESH_DAYS.max,
                })
              : null
          }
        />
      </div>

      <div className="flex items-start gap-2">
        <input
          id={`${idPrefix}-crawl-authorized`}
          type="checkbox"
          checked={value.authorized}
          onChange={(event) => set({ authorized: event.target.checked })}
          className="mt-0.5"
        />
        <label htmlFor={`${idPrefix}-crawl-authorized`} className="text-sm text-content">
          {t('playbook.knowledge.crawl.authorized')}
        </label>
      </div>
    </fieldset>
  );
}

function PathsField({
  id,
  label,
  help,
  invalid,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  invalid: boolean;
  value: string;
  onChange: (next: string) => void;
}): ReactElement {
  const t = useTranslate();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={`${id}-help`}
        placeholder="/yardim"
        className={`resize-y ${INPUT}`}
      />
      <span id={`${id}-help`} className={HELP}>
        {help}
      </span>
      <FieldError
        id={`${id}-error`}
        message={invalid ? t('playbook.knowledge.crawl.pathsError') : null}
      />
    </div>
  );
}
