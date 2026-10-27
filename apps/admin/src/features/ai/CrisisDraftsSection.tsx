/**
 * Crisis-text drafts (tm 389.19 · FR-ADMIN-23 · AI-08-S1): per country, an English and a Turkish
 * text the platform suggests for the responsible-gaming hand-over. A workspace sees the one for
 * its country as "use the platform's draft" on its own Compliance page, edits it and approves it
 * itself — nothing is published on its behalf. The whole map is saved at once with a reason,
 * which lands in the platform audit chain (the countries touched, never a text). A role without
 * `ai.manage` reads the same screen with every field disabled; the server refuses its writes
 * either way.
 */
import {
  CRISIS_DRAFT_COUNTRIES_MAX,
  CRISIS_DRAFT_COUNTRY_PATTERN,
  PLATFORM_CRISIS_TEXT_MAX,
  type CrisisDraftLang,
  type CrisisTextDrafts,
} from '@siyahtus/types';
import { useState, type ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { cn } from '../../components/ui/index.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import { FIELD_CLASS, Loading, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { useCrisisTextDrafts, useSaveCrisisTextDrafts } from './queries.js';

const LANGS: readonly CrisisDraftLang[] = ['en', 'tr'];
const TAG = /<\/?[a-z!][^>]*>/i;

interface DraftRow {
  country: string;
  en: string;
  tr: string;
}

interface DraftValues {
  rows: DraftRow[];
}

function rowsOf(drafts: CrisisTextDrafts): DraftRow[] {
  return Object.keys(drafts)
    .sort()
    .map((country) => ({
      country,
      en: drafts[country]?.en ?? '',
      tr: drafts[country]?.tr ?? '',
    }));
}

function draftsOf(rows: DraftRow[]): CrisisTextDrafts {
  const drafts: CrisisTextDrafts = {};
  for (const row of rows) {
    const en = row.en.trim();
    const tr = row.tr.trim();
    drafts[row.country] = { ...(en ? { en } : {}), ...(tr ? { tr } : {}) };
  }
  return drafts;
}

/** What is wrong with the draft, if anything — the save stays off until nothing is. */
export function draftProblem(rows: DraftRow[]): 'country' | 'duplicate' | 'empty' | 'text' | null {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!CRISIS_DRAFT_COUNTRY_PATTERN.test(row.country)) return 'country';
    if (seen.has(row.country)) return 'duplicate';
    seen.add(row.country);
    const en = row.en.trim();
    const tr = row.tr.trim();
    if (!en && !tr) return 'empty';
    for (const text of [en, tr]) {
      if (text.length > PLATFORM_CRISIS_TEXT_MAX || TAG.test(text)) return 'text';
    }
  }
  return null;
}

export function CrisisDraftsSection(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'ai.manage');
  const query = useCrisisTextDrafts();

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-content-secondary">{t('ai.crisis.intro')}</p>
      {query.isError ? (
        <Card>
          <LoadError
            title={t('ai.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.data === undefined ? (
        <Card>
          <Loading label={t('ai.loading')} />
        </Card>
      ) : (
        <>
          {query.data.updated_at && (
            <p className="text-xs text-content-secondary">
              {t('ai.crisis.updatedAt', { date: formatDateTime(query.data.updated_at) ?? '—' })}
            </p>
          )}
          <Card>
            <DraftsForm
              key={query.data.version}
              saved={{ rows: rowsOf(query.data.drafts) }}
              canManage={canManage}
            />
          </Card>
        </>
      )}
    </div>
  );
}

function DraftsForm({
  saved,
  canManage,
}: {
  saved: DraftValues;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const save = useSaveCrisisTextDrafts();
  const [country, setCountry] = useState('');
  const normalized = country.trim().toUpperCase();

  return (
    <SettingsForm<DraftValues>
      saved={saved}
      label={t('ai.crisis.title')}
      isValid={(values) => draftProblem(values.rows) === null}
      highRisk={{
        labels: { rows: t('ai.crisis.title') },
        format: (_key, value) => {
          const rows = value as DraftRow[];
          return rows.length === 0
            ? t('ai.crisis.none')
            : rows
                .map((row) =>
                  t('ai.crisis.confirmRow', {
                    country: row.country,
                    en: row.en.trim().length,
                    tr: row.tr.trim().length,
                  }),
                )
                .join('; ');
        },
      }}
      onSave={(values, extra) =>
        save.mutateAsync({ reason: extra.reason ?? '', drafts: draftsOf(values.rows) })
      }
      className="flex flex-col gap-4 p-4"
    >
      {({ values, setValue }) => {
        const problem = draftProblem(values.rows);
        const update = (index: number, patch: Partial<DraftRow>): void =>
          setValue(
            'rows',
            values.rows.map((row, at) => (at === index ? { ...row, ...patch } : row)),
          );
        const canAdd =
          CRISIS_DRAFT_COUNTRY_PATTERN.test(normalized) &&
          !values.rows.some((row) => row.country === normalized) &&
          values.rows.length < CRISIS_DRAFT_COUNTRIES_MAX;
        return (
          <fieldset disabled={!canManage} className="flex flex-col gap-4">
            <legend className="text-sm font-semibold">{t('ai.crisis.title')}</legend>
            {values.rows.length === 0 && (
              <p className="text-sm text-content-secondary">{t('ai.crisis.empty')}</p>
            )}
            {values.rows.map((row, index) => (
              <div
                key={row.country}
                role="group"
                aria-label={t('ai.crisis.country', { country: row.country })}
                className="rounded-md border border-border p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="tabular text-sm font-medium">{row.country}</h3>
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    onClick={() =>
                      setValue(
                        'rows',
                        values.rows.filter((_, at) => at !== index),
                      )
                    }
                  >
                    {t('ai.crisis.remove', { country: row.country })}
                  </button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {LANGS.map((lang) => {
                    const id = `crisis-${row.country}-${lang}`;
                    return (
                      <div key={lang}>
                        <label htmlFor={id} className="text-sm font-medium">
                          {t(`ai.crisis.lang.${lang}`)}
                        </label>
                        <textarea
                          id={id}
                          rows={4}
                          maxLength={PLATFORM_CRISIS_TEXT_MAX}
                          value={row[lang]}
                          onChange={(event) => update(index, { [lang]: event.target.value })}
                          className={cn(FIELD_CLASS, 'font-sans')}
                        />
                        <p className="tabular text-xs text-content-secondary">
                          {row[lang].length} / {PLATFORM_CRISIS_TEXT_MAX}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            {problem !== null && (
              <p role="alert" className="text-sm text-danger">
                {t(`ai.crisis.problem.${problem}`, { max: PLATFORM_CRISIS_TEXT_MAX })}
              </p>
            )}
            {canManage && (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="crisis-new-country" className="text-sm font-medium">
                    {t('ai.crisis.newCountry')}
                  </label>
                  <input
                    id="crisis-new-country"
                    value={country}
                    maxLength={2}
                    onChange={(event) => setCountry(event.target.value)}
                    aria-describedby="crisis-new-country-hint"
                    className={cn(FIELD_CLASS, 'w-24 uppercase')}
                  />
                </div>
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={!canAdd}
                  onClick={() => {
                    setValue(
                      'rows',
                      [...values.rows, { country: normalized, en: '', tr: '' }].sort((a, b) =>
                        a.country.localeCompare(b.country),
                      ),
                    );
                    setCountry('');
                  }}
                >
                  {t('ai.crisis.add')}
                </button>
                <p
                  id="crisis-new-country-hint"
                  className="basis-full text-xs text-content-secondary"
                >
                  {t('ai.crisis.newCountry.hint', { max: CRISIS_DRAFT_COUNTRIES_MAX })}
                </p>
              </div>
            )}
          </fieldset>
        );
      }}
    </SettingsForm>
  );
}
