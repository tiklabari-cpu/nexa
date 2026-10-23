/**
 * The Archive's filter bar (AR-02 · tm 336.2): one chip per filter, each opening a
 * small panel; the date chip steps ‹ › through the calendar and never past today.
 *
 * The filters live in the address (`archive-filters.ts`, ids only) — this bar
 * reads them and reports a change, it keeps no state of its own besides a
 * panel's search box. No panel shows a live count: counting every option against
 * the whole archive on each open is what the list's own total is for (AR-02).
 *
 * Filters that cannot all hold are never repaired behind the person's back: the
 * bar says which ones clash and the list is asked for as written.
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import {
  ADAPTER_CHANNEL_TYPES,
  ARCHIVE_MAX_FILTER_IDS,
  ARCHIVE_MAX_TAGS,
  ARCHIVE_RATING_FILTERS,
  ARCHIVE_TAG_MODES,
  RISK_FLAG_TYPES,
  THREAD_HANDLED_BY,
} from '@siyahtus/types';
import { Banner, Dropdown, cn } from '../../components/ui/index.js';
import { useAuth } from '../../lib/auth-store.js';
import { enumLabel } from '../../lib/enum-label.js';
import { formatDay } from '../../lib/format.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import {
  DATE_PRESETS,
  NO_FILTERS,
  agentFilterIsSelfOnly,
  findConflicts,
  isFiltered,
  matchPreset,
  presetRange,
  shiftRange,
  todayKey,
  type ArchiveFilters,
} from './archive-filters.js';
import {
  SAVED_ARCHIVE_FILTER_NAME_MAX,
  applySaved,
  saveBlocked,
  useSavedArchiveFilters,
} from './saved-filters.js';
import { useAgentRoster, useDayBoundary, useTagLibrary } from './useArchive.js';

const CHIP_BASE =
  'inline-flex items-center rounded-full border text-xs transition-colors focus-within:ring-2 focus-within:ring-brand-500/40';
const CHIP_IDLE = 'border-border bg-surface text-content-secondary';
const CHIP_ACTIVE = 'border-brand-500/40 bg-brand-100 text-content dark:bg-brand-950';
const STEP_BUTTON =
  'px-2 py-1 text-content-secondary hover:text-content disabled:cursor-not-allowed disabled:opacity-40';
const PANEL = 'left-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] p-2';

/** `list` with `value` in or out, keeping the order it was added in. */
function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  const rest = list.filter((entry) => entry !== value);
  return on ? [...rest, value] : rest;
}

/** One name when there is one to show, otherwise how many are chosen. */
function summarise(t: TFunction, names: readonly (string | undefined)[], count: number): string {
  const [first] = names;
  if (count === 1 && first) return first;
  return t('archive.filter.selected', { count });
}

function Chip({
  label,
  summary,
  onClear,
  lead,
  trail,
  children,
}: {
  label: string;
  /** What is chosen, in words; null when the filter is off. */
  summary: string | null;
  onClear: () => void;
  /** Controls before the chip's button (the date chip's ‹). */
  lead?: ReactNode;
  /** Controls after it (the date chip's ›). */
  trail?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const t = useTranslate();
  const active = summary !== null;
  return (
    <div className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_IDLE)}>
      {lead}
      <Dropdown
        label={active ? t('archive.filter.chip.named', { label, value: summary }) : label}
        trigger={
          <span>
            {label}
            {active && (
              <>
                : <span className="font-medium">{summary}</span>
              </>
            )}
          </span>
        }
        triggerClassName="block rounded-full px-2.5 py-1 hover:text-content"
        panelClassName={PANEL}
      >
        {() => <div className="flex flex-col gap-2 text-sm text-content">{children}</div>}
      </Dropdown>
      {trail}
      {active && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('archive.filter.clearOne', { label })}
          className="rounded-full py-1 pl-0.5 pr-2 text-content-secondary hover:text-content"
        >
          <span aria-hidden="true">×</span>
        </button>
      )}
    </div>
  );
}

interface Option<T> {
  value: T;
  label: string;
}

/** Several of many: the values of one filter, OR-ed (AR-02). */
function CheckList<T extends string | number>({
  legend,
  options,
  selected,
  onChange,
  max,
  limitNote,
  search,
}: {
  legend: string;
  options: readonly Option<T>[];
  selected: readonly T[];
  onChange: (next: T[]) => void;
  /** The most the API takes; the rest turn off once it is reached. */
  max?: number;
  limitNote?: string;
  /** A search box over the options, for lists that can be long. */
  search?: { label: string };
}): ReactElement {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((option) => option.label.toLowerCase().includes(needle))
    : options;
  const full = max !== undefined && selected.length >= max;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="sr-only">{legend}</legend>
      {search && options.length > 8 && (
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={search.label}
          placeholder={search.label}
          className="rounded-md border border-border bg-inset px-2 py-1 text-sm"
        />
      )}
      <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
        {shown.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={String(option.value)}
              className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-2"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && full}
                onChange={(event) =>
                  onChange(toggled(selected, option.value, event.target.checked))
                }
              />
              <span className="min-w-0 break-words">{option.label}</span>
            </label>
          );
        })}
      </div>
      {full && limitNote && <p className="text-2xs text-content-tertiary">{limitNote}</p>}
    </fieldset>
  );
}

/** One of many, with a way back to "no filter". */
function RadioList<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly Option<T | null>[];
  value: T | null;
  onChange: (next: T | null) => void;
}): ReactElement {
  const group = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-0.5">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value ?? 'none'}
          className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-2"
        >
          <input
            type="radio"
            name={group}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ArchiveFilters({
  filters,
  onChange,
  teams,
}: {
  filters: ArchiveFilters;
  onChange: (next: ArchiveFilters) => void;
  /** Team names by number (the list's own team column reads the same). */
  teams: ReadonlyMap<number, string>;
}): ReactElement {
  const t = useTranslate();
  const role = useAuth((s) => s.agent?.role);
  const accountId = useAuth((s) => s.agent?.account_id ?? null);
  const selfOnly = agentFilterIsSelfOnly(role);

  const boundary = useDayBoundary();
  const today = todayKey(boundary);
  const roster = useAgentRoster(!selfOnly);
  const library = useTagLibrary();
  const savedFilters = useSavedArchiveFilters(accountId);

  const set = (patch: Partial<ArchiveFilters>): void => onChange({ ...filters, ...patch });
  const conflicts = findConflicts(filters);

  // --- Names for what the address names by id ---------------------------------
  const rosterNames = new Map(
    (roster.data?.items ?? []).map((member) => [
      member.id,
      member.name ?? t('archive.filter.agent.unnamed'),
    ]),
  );
  const tagNames = new Map((library.data?.items ?? []).map((tag) => [tag.id, tag.name]));
  const teamOptions = [...teams]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const agentOptions = [...rosterNames]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const tagOptions = [...tagNames]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // --- Date ---------------------------------------------------------------------
  const preset = matchPreset(filters, today);
  const dateSummary = ((): string | null => {
    if (!filters.dateFrom && !filters.dateTo) return null;
    if (preset) return t(`archive.filter.date.preset.${preset}`);
    const from = filters.dateFrom ? (formatDay(filters.dateFrom) ?? filters.dateFrom) : null;
    const to = filters.dateTo ? (formatDay(filters.dateTo) ?? filters.dateTo) : null;
    if (from && to) return from === to ? from : `${from} – ${to}`;
    return from
      ? t('archive.filter.date.since', { date: from })
      : t('archive.filter.date.until', { date: to ?? '' });
  })();
  const earlier = shiftRange(filters, 'earlier', today);
  const later = shiftRange(filters, 'later', today);

  // --- Tags ---------------------------------------------------------------------
  const tagSummary = ((): string | null => {
    if (filters.untagged && filters.tagIds.length === 0)
      return t('archive.filter.tags.untaggedShort');
    if (filters.tagIds.length === 0) return null;
    const value = summarise(
      t,
      filters.tagIds.map((id) => tagNames.get(id)),
      filters.tagIds.length,
    );
    const withMode =
      filters.tagMode === 'any'
        ? value
        : t(`archive.filter.tags.summary.${filters.tagMode}`, { value });
    return filters.untagged ? `${withMode} + ${t('archive.filter.tags.untaggedShort')}` : withMode;
  })();

  // --- Agent --------------------------------------------------------------------
  const agentSummary = ((): string | null => {
    if (filters.agentIds.length === 0) return null;
    if (selfOnly && filters.agentIds.length === 1 && filters.agentIds[0] === accountId) {
      return t('archive.filter.agent.me');
    }
    return summarise(
      t,
      filters.agentIds.map((id) => rosterNames.get(id)),
      filters.agentIds.length,
    );
  })();

  const filtered = isFiltered(filters);

  return (
    <div className="flex flex-col border-b border-border">
      <div
        role="group"
        aria-label={t('archive.filter.region')}
        className="flex flex-wrap items-center gap-1.5 px-4 py-2"
      >
        {/* Date: presets, a custom range, and ‹ › to step through the calendar. */}
        <Chip
          label={t('archive.filter.date.label')}
          summary={dateSummary}
          onClear={() => set({ dateFrom: null, dateTo: null })}
          lead={
            filters.dateFrom ? (
              <button
                type="button"
                disabled={earlier === null}
                onClick={() => earlier && set(earlier)}
                aria-label={t('archive.filter.date.earlier')}
                className={cn(STEP_BUTTON, 'rounded-l-full pl-2.5')}
              >
                <span aria-hidden="true">‹</span>
              </button>
            ) : undefined
          }
          trail={
            filters.dateFrom ? (
              <button
                type="button"
                disabled={later === null}
                onClick={() => later && set(later)}
                aria-label={t('archive.filter.date.later')}
                className={STEP_BUTTON}
              >
                <span aria-hidden="true">›</span>
              </button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-0.5">
            {DATE_PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={preset === id}
                onClick={() => set(presetRange(id, today))}
                className={cn(
                  'rounded px-2 py-1 text-left hover:bg-surface-2',
                  preset === id && 'bg-brand-100 font-medium dark:bg-brand-950',
                )}
              >
                {t(`archive.filter.date.preset.${id}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>{t('archive.filter.date.from')}</span>
              <input
                type="date"
                value={filters.dateFrom ?? ''}
                max={today}
                onChange={(event) => set({ dateFrom: event.target.value || null })}
                className="rounded-md border border-border bg-inset px-1.5 py-1 text-sm"
              />
            </label>
            <label className="flex items-center justify-between gap-2 text-xs">
              <span>{t('archive.filter.date.to')}</span>
              <input
                type="date"
                value={filters.dateTo ?? ''}
                max={today}
                onChange={(event) => set({ dateTo: event.target.value || null })}
                className="rounded-md border border-border bg-inset px-1.5 py-1 text-sm"
              />
            </label>
            <p className="text-2xs text-content-tertiary">{t('archive.filter.date.hint')}</p>
          </div>
        </Chip>

        {/* Agent: everyone for a Team Lead and above, only "me" for a Team Member. */}
        <Chip
          label={t('archive.filter.agent.label')}
          summary={agentSummary}
          onClear={() => set({ agentIds: [] })}
        >
          {selfOnly ? (
            <CheckList
              legend={t('archive.filter.agent.label')}
              options={accountId ? [{ value: accountId, label: t('archive.filter.agent.me') }] : []}
              selected={filters.agentIds}
              onChange={(agentIds) => set({ agentIds })}
            />
          ) : roster.isError ? (
            <p role="alert" className="text-xs text-danger">
              {t('archive.filter.loadFailed')}
            </p>
          ) : (
            <CheckList
              legend={t('archive.filter.agent.label')}
              options={agentOptions}
              selected={filters.agentIds}
              onChange={(agentIds) => set({ agentIds })}
              max={ARCHIVE_MAX_FILTER_IDS}
              limitNote={t('archive.filter.limit', { max: ARCHIVE_MAX_FILTER_IDS })}
              search={{ label: t('archive.filter.search') }}
            />
          )}
        </Chip>

        <Chip
          label={t('archive.filter.team.label')}
          summary={
            filters.groupIds.length > 0
              ? summarise(
                  t,
                  filters.groupIds.map((id) => teams.get(id)),
                  filters.groupIds.length,
                )
              : null
          }
          onClear={() => set({ groupIds: [] })}
        >
          <CheckList
            legend={t('archive.filter.team.label')}
            options={teamOptions}
            selected={filters.groupIds}
            onChange={(groupIds) => set({ groupIds })}
            max={ARCHIVE_MAX_FILTER_IDS}
            limitNote={t('archive.filter.limit', { max: ARCHIVE_MAX_FILTER_IDS })}
            search={{ label: t('archive.filter.search') }}
          />
        </Chip>

        <Chip
          label={t('archive.filter.rating.label')}
          summary={filters.rating ? t(`archive.filter.rating.${filters.rating}`) : null}
          onClear={() => set({ rating: null })}
        >
          <RadioList
            legend={t('archive.filter.rating.label')}
            options={[
              { value: null, label: t('archive.filter.rating.none') },
              ...ARCHIVE_RATING_FILTERS.map((value) => ({
                value,
                label: t(`archive.filter.rating.${value}`),
              })),
            ]}
            value={filters.rating}
            onChange={(rating) => set({ rating })}
          />
        </Chip>

        {/* Tags: any / all / exclude, at most 20, or only the untagged. */}
        <Chip
          label={t('archive.filter.tags.label')}
          summary={tagSummary}
          onClear={() => set({ tagIds: [], tagMode: 'any', untagged: false })}
        >
          <RadioList
            legend={t('archive.filter.tags.mode')}
            options={ARCHIVE_TAG_MODES.map((value) => ({
              value,
              label: t(`archive.filter.tags.mode.${value}`),
            }))}
            value={filters.tagMode}
            onChange={(tagMode) => set({ tagMode: tagMode ?? 'any' })}
          />
          <div className="border-t border-border pt-2">
            {library.isError ? (
              <p role="alert" className="text-xs text-danger">
                {t('archive.filter.loadFailed')}
              </p>
            ) : tagOptions.length === 0 && !library.isPending ? (
              <p className="text-xs text-content-secondary">{t('archive.filter.tags.none')}</p>
            ) : (
              <CheckList
                legend={t('archive.filter.tags.label')}
                options={tagOptions}
                selected={filters.tagIds}
                onChange={(tagIds) => set({ tagIds })}
                max={ARCHIVE_MAX_TAGS}
                limitNote={t('archive.filter.tags.limit', { max: ARCHIVE_MAX_TAGS })}
                search={{ label: t('archive.filter.search') }}
              />
            )}
          </div>
          <label className="flex items-center gap-2 border-t border-border px-1 pt-2">
            <input
              type="checkbox"
              checked={filters.untagged}
              onChange={(event) => set({ untagged: event.target.checked })}
            />
            <span>{t('archive.filter.tags.untagged')}</span>
          </label>
        </Chip>

        <Chip
          label={t('archive.filter.handledBy.label')}
          summary={
            filters.handledBy.length > 0
              ? summarise(
                  t,
                  filters.handledBy.map((value) => t(`archive.filter.handledBy.${value}`)),
                  filters.handledBy.length,
                )
              : null
          }
          onClear={() => set({ handledBy: [] })}
        >
          <CheckList
            legend={t('archive.filter.handledBy.label')}
            options={THREAD_HANDLED_BY.map((value) => ({
              value,
              label: t(`archive.filter.handledBy.${value}`),
            }))}
            selected={filters.handledBy}
            onChange={(handledBy) => set({ handledBy })}
          />
        </Chip>

        <Chip
          label={t('archive.filter.risk.label')}
          summary={
            filters.riskFlags.length > 0
              ? summarise(
                  t,
                  filters.riskFlags.map((value) => enumLabel(t, 'inbox.risk.type', value)),
                  filters.riskFlags.length,
                )
              : null
          }
          onClear={() => set({ riskFlags: [] })}
        >
          <CheckList
            legend={t('archive.filter.risk.label')}
            options={RISK_FLAG_TYPES.map((value) => ({
              value,
              label: enumLabel(t, 'inbox.risk.type', value),
            }))}
            selected={filters.riskFlags}
            onChange={(riskFlags) => set({ riskFlags })}
          />
        </Chip>

        <Chip
          label={t('archive.filter.channel.label')}
          summary={filters.channel ? t(`archive.filter.channel.${filters.channel}`) : null}
          onClear={() => set({ channel: null })}
        >
          <RadioList
            legend={t('archive.filter.channel.label')}
            options={[
              { value: null, label: t('archive.filter.channel.none') },
              ...ADAPTER_CHANNEL_TYPES.map((value) => ({
                value,
                label: t(`archive.filter.channel.${value}`),
              })),
            ]}
            value={filters.channel}
            onChange={(channel) => set({ channel })}
          />
        </Chip>

        {accountId && (
          <SavedFilters filters={filters} onApply={(next) => onChange(next)} store={savedFilters} />
        )}

        {filtered && (
          <button
            type="button"
            onClick={() => onChange(NO_FILTERS)}
            className="rounded-full px-2 py-1 text-xs text-content-secondary underline-offset-2 hover:text-content hover:underline"
          >
            {t('archive.filter.clearAll')}
          </button>
        )}
      </div>

      {conflicts.length > 0 && (
        <Banner tone="warning" className="mx-4 mb-2" title={t('archive.filter.conflict.title')}>
          <ul className="list-disc pl-4">
            {conflicts.map((conflict) => (
              <li key={conflict}>{t(`archive.filter.conflict.${conflict}`)}</li>
            ))}
          </ul>
        </Banner>
      )}
    </div>
  );
}

/** Personal saved filters (AR-02-S3): kept in this browser, minus the dates. */
function SavedFilters({
  filters,
  onApply,
  store,
}: {
  filters: ArchiveFilters;
  onApply: (next: ArchiveFilters) => void;
  store: ReturnType<typeof useSavedArchiveFilters>;
}): ReactElement {
  const t = useTranslate();
  const [name, setName] = useState('');
  const blocked = saveBlocked(store.saved, name, filters);

  return (
    <div className={cn(CHIP_BASE, CHIP_IDLE)}>
      <Dropdown
        label={t('archive.filter.saved.label')}
        trigger={<span>{t('archive.filter.saved.label')}</span>}
        triggerClassName="block rounded-full px-2.5 py-1 hover:text-content"
        panelClassName={PANEL}
      >
        {({ close }) => (
          <div className="flex flex-col gap-2 text-sm text-content">
            {store.saved.length === 0 ? (
              <p className="text-xs text-content-secondary">{t('archive.filter.saved.none')}</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {store.saved.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onApply(applySaved(entry, filters));
                        close(true);
                      }}
                      className="min-w-0 flex-1 break-words rounded px-2 py-1 text-left hover:bg-surface-2"
                    >
                      {entry.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => store.remove(entry.id)}
                      aria-label={t('archive.filter.saved.delete', { name: entry.name })}
                      className="rounded px-1.5 py-1 text-content-secondary hover:text-danger"
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex flex-col gap-1 border-t border-border pt-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (store.save(name, filters)) setName('');
              }}
            >
              <label className="flex flex-col gap-1 text-xs">
                <span>{t('archive.filter.saved.name')}</span>
                <input
                  type="text"
                  value={name}
                  maxLength={SAVED_ARCHIVE_FILTER_NAME_MAX}
                  onChange={(event) => setName(event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={blocked !== null}
                className="self-start rounded-md border border-border bg-inset px-3 py-1 text-sm font-medium disabled:opacity-60"
              >
                {t('archive.filter.saved.save')}
              </button>
              {name.trim() !== '' && blocked && blocked !== 'name' && (
                <p className="text-2xs text-content-tertiary">
                  {t(`archive.filter.saved.blocked.${blocked}`)}
                </p>
              )}
              <p className="text-2xs text-content-tertiary">{t('archive.filter.saved.hint')}</p>
            </form>
          </div>
        )}
      </Dropdown>
    </div>
  );
}
