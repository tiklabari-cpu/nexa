/**
 * Settings › AI (tm 389.17 · FR-ADMIN-17/19 · design.md §D): the model and the embedding provider
 * every workspace's AI uses, their API keys, the deployment's daily caps and prices — and the two
 * actions on them, "Test the connection" and "Re-embed".
 *
 * Each part is either set here or left to the tenant API's environment (`LLM_*`, `EMBEDDING_*`,
 * `AI_DAILY_*`, `AI_PRICE_*`); the badge says which. An API key is write-only: the field starts
 * empty, saving seals it on the server, and from then on only "•••• last4" is ever shown, with
 * Change / Remove. Saving wants a reason and a fresh authenticator code (`ReasonDialog`); the
 * server refuses what production would (the regional host, the stub under the pilot, the width).
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner, cn } from '../../components/ui/index.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type {
  PlatformAiConnectionTest,
  PlatformAiSettings,
  PlatformAiSettingsRequest,
} from '../../lib/platform-types.js';
import { LoadError } from '../../components/LoadError.js';
import {
  FIELD_CLASS,
  Loading,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';
import {
  useAiSettings,
  useSaveAiSettings,
  useStartReembed,
  useTestAiConnection,
} from './queries.js';

/** The embedding width the schema fixes (`knowledge_chunks.embedding vector(1536)`). */
export const EMBEDDING_WIDTH = 1536;

type Choice = 'env' | 'mock' | 'openai';
type Region = '' | 'eu' | 'us';

/** What happens to the stored key on save. */
export interface KeyEdit {
  mode: 'keep' | 'replace' | 'remove';
  value: string;
}

export interface AiDraft {
  llm: {
    choice: Choice;
    baseUrl: string;
    model: string;
    modelFast: string;
    region: Region;
    timeoutMs: string;
    maxOutputTokens: string;
    key: KeyEdit;
  };
  embedding: { choice: Choice; baseUrl: string; model: string; region: Region; key: KeyEdit };
  caps: {
    llmWorkspace: string;
    llmGlobal: string;
    embeddingWorkspace: string;
    embeddingGlobal: string;
  };
  prices: { llmInput: string; llmOutput: string; embedding: string };
}

const KEEP: KeyEdit = { mode: 'keep', value: '' };
const text = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

/** The form as the stored settings read. */
export function draftOf(settings: PlatformAiSettings): AiDraft {
  const { llm, embedding, caps, prices } = settings;
  return {
    llm: {
      choice: llm ? llm.provider : 'env',
      baseUrl: text(llm?.base_url),
      model: text(llm?.model),
      modelFast: text(llm?.model_fast),
      region: (llm?.region ?? '') as Region,
      timeoutMs: text(llm?.timeout_ms),
      maxOutputTokens: text(llm?.max_output_tokens),
      key: KEEP,
    },
    embedding: {
      choice: embedding ? embedding.provider : 'env',
      baseUrl: text(embedding?.base_url),
      model: text(embedding?.model),
      region: (embedding?.region ?? '') as Region,
      key: KEEP,
    },
    caps: {
      llmWorkspace: text(caps?.llm.workspace),
      llmGlobal: text(caps?.llm.global),
      embeddingWorkspace: text(caps?.embedding.workspace),
      embeddingGlobal: text(caps?.embedding.global),
    },
    prices: {
      llmInput: text(prices?.llm_input_usd_per_mtok),
      llmOutput: text(prices?.llm_output_usd_per_mtok),
      embedding: text(prices?.embedding_usd_per_mtok),
    },
  };
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
const intOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value));

function keyField(key: KeyEdit): { api_key?: string | null } {
  if (key.mode === 'replace') return { api_key: key.value.trim() };
  if (key.mode === 'remove') return { api_key: null };
  return {};
}

/** The request the form sends — every part, so a removed part goes back to the environment. */
export function requestOf(draft: AiDraft, reason: string): PlatformAiSettingsRequest {
  const { llm, embedding, caps, prices } = draft;
  const allCaps = Object.values(caps).every((value) => value.trim() !== '');
  const anyPrice = Object.values(prices).some((value) => value.trim() !== '');
  const price = (value: string): number | null => (value.trim() === '' ? null : Number(value));
  return {
    reason,
    llm:
      llm.choice === 'env'
        ? null
        : {
            provider: llm.choice,
            base_url: orNull(llm.baseUrl),
            model: orNull(llm.model),
            model_fast: orNull(llm.modelFast),
            region: llm.region === '' ? null : llm.region,
            timeout_ms: intOrNull(llm.timeoutMs),
            max_output_tokens: intOrNull(llm.maxOutputTokens),
            ...keyField(llm.key),
          },
    embedding:
      embedding.choice === 'env'
        ? null
        : {
            provider: embedding.choice,
            base_url: orNull(embedding.baseUrl),
            model: orNull(embedding.model),
            region: embedding.region === '' ? null : embedding.region,
            dimensions: EMBEDDING_WIDTH,
            ...keyField(embedding.key),
          },
    caps: allCaps
      ? {
          llm: { workspace: Number(caps.llmWorkspace), global: Number(caps.llmGlobal) },
          embedding: {
            workspace: Number(caps.embeddingWorkspace),
            global: Number(caps.embeddingGlobal),
          },
        }
      : null,
    prices: anyPrice
      ? {
          llm_input_usd_per_mtok: price(prices.llmInput),
          llm_output_usd_per_mtok: price(prices.llmOutput),
          embedding_usd_per_mtok: price(prices.embedding),
        }
      : null,
  };
}

const positiveInt = (value: string): boolean =>
  value.trim() === '' || (Number.isInteger(Number(value)) && Number(value) >= 1);
const priceValid = (value: string): boolean =>
  value.trim() === '' || (Number.isFinite(Number(value)) && Number(value) >= 0);

/** What the form holds back on, by field group. Empty: it may be saved. */
export function draftProblems(
  draft: AiDraft,
): Array<'llm' | 'embedding' | 'key' | 'caps' | 'prices'> {
  const problems: Array<'llm' | 'embedding' | 'key' | 'caps' | 'prices'> = [];
  const remote = (part: { choice: Choice; baseUrl: string; model: string; region: Region }) =>
    part.choice === 'openai' &&
    (part.baseUrl.trim() === '' || part.model.trim() === '' || part.region === '');
  if (
    remote(draft.llm) ||
    !positiveInt(draft.llm.timeoutMs) ||
    !positiveInt(draft.llm.maxOutputTokens)
  ) {
    problems.push('llm');
  }
  if (remote(draft.embedding)) problems.push('embedding');
  for (const key of [draft.llm.key, draft.embedding.key]) {
    if (key.mode === 'replace' && key.value.trim().length < 8) problems.push('key');
  }
  const caps = Object.values(draft.caps);
  const filled = caps.filter((value) => value.trim() !== '').length;
  if ((filled !== 0 && filled !== caps.length) || !caps.every(positiveInt)) problems.push('caps');
  if (!Object.values(draft.prices).every(priceValid)) problems.push('prices');
  return problems;
}

export function AiSettingsSection(): ReactElement {
  const t = useTranslate();
  const query = useAiSettings();
  // Here rather than in the form: it outlives the save that raised it.
  const [warning, setWarning] = useState(false);
  return (
    <Card>
      <section aria-labelledby="settings-ai-title" className="flex flex-col gap-4 p-4">
        <h2 id="settings-ai-title" className="text-sm font-semibold">
          {t('settings.ai.title')}
        </h2>
        <p className="text-xs text-content-secondary">{t('settings.ai.hint')}</p>
        {warning && (
          <Banner tone="warning" role="status">
            {t('settings.ai.reembedRequired')}
          </Banner>
        )}
        {query.isError ? (
          <LoadError
            title={t('settings.ai.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Loading label={t('settings.loading')} />
        ) : (
          <AiSettingsForm settings={query.data} onWarning={setWarning} />
        )}
      </section>
    </Card>
  );
}

function AiSettingsForm({
  settings,
  onWarning,
}: {
  settings: PlatformAiSettings;
  onWarning: (warning: boolean) => void;
}): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'ai.manage');
  const canRun = hasPermission(me, 'operations.run');
  const save = useSaveAiSettings();
  const saved = draftOf(settings);
  const [draft, setDraft] = useState<AiDraft>(saved);
  const [saving, setSaving] = useState(false);
  const problems = draftProblems(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const embeddingMoved =
    draft.embedding.choice !== saved.embedding.choice ||
    draft.embedding.model.trim() !== saved.embedding.model.trim();

  // Each caller passes fields of the part it names.
  const set = (part: keyof AiDraft, patch: object): void =>
    setDraft((current) => ({ ...current, [part]: { ...current[part], ...patch } }));

  return (
    <>
      <form
        aria-label={t('settings.ai.title')}
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setSaving(true);
        }}
      >
        <fieldset disabled={!canManage} className="flex flex-col gap-4">
          <PartFields
            part="llm"
            title={t('settings.ai.llm.title')}
            source={settings.source.llm}
            draft={draft.llm}
            last4={settings.llm?.api_key_last4 ?? null}
            invalid={problems.includes('llm')}
            onChange={(patch) => set('llm', patch)}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                id="settings-ai-llm-fast"
                label={t('settings.ai.modelFast')}
                hint={t('settings.ai.modelFast.hint')}
                value={draft.llm.modelFast}
                onChange={(value) => set('llm', { modelFast: value })}
              />
              <TextField
                id="settings-ai-llm-timeout"
                label={t('settings.ai.timeout')}
                hint={t('settings.ai.limits.hint')}
                inputMode="numeric"
                value={draft.llm.timeoutMs}
                onChange={(value) => set('llm', { timeoutMs: value })}
              />
              <TextField
                id="settings-ai-llm-max"
                label={t('settings.ai.maxOutputTokens')}
                hint={t('settings.ai.limits.hint')}
                inputMode="numeric"
                value={draft.llm.maxOutputTokens}
                onChange={(value) => set('llm', { maxOutputTokens: value })}
              />
            </div>
          </PartFields>

          <PartFields
            part="embedding"
            title={t('settings.ai.embedding.title')}
            source={settings.source.embedding}
            draft={draft.embedding}
            last4={settings.embedding?.api_key_last4 ?? null}
            invalid={problems.includes('embedding')}
            onChange={(patch) => set('embedding', patch)}
          >
            <p className="text-xs text-content-secondary">
              {t('settings.ai.dimensions', { n: EMBEDDING_WIDTH })}
            </p>
            {embeddingMoved && (
              <p role="alert" className="text-xs text-warning">
                {t('settings.ai.embedding.changeWarning')}
              </p>
            )}
          </PartFields>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t('settings.ai.caps.title')}</legend>
            <p className="text-xs text-content-secondary">{t('settings.ai.caps.hint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                ['llmWorkspace', 'llmGlobal', 'embeddingWorkspace', 'embeddingGlobal'] as const
              ).map((field) => (
                <TextField
                  key={field}
                  id={`settings-ai-caps-${field}`}
                  label={t(`settings.ai.caps.${field}`)}
                  inputMode="numeric"
                  value={draft.caps[field]}
                  onChange={(value) => set('caps', { [field]: value })}
                />
              ))}
            </div>
            {problems.includes('caps') && (
              <p role="alert" className="text-xs text-danger">
                {t('settings.ai.caps.incomplete')}
              </p>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">{t('settings.ai.prices.title')}</legend>
            <p className="text-xs text-content-secondary">{t('settings.ai.prices.hint')}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(['llmInput', 'llmOutput', 'embedding'] as const).map((field) => (
                <TextField
                  key={field}
                  id={`settings-ai-prices-${field}`}
                  label={t(`settings.ai.prices.${field}`)}
                  inputMode="decimal"
                  value={draft.prices[field]}
                  onChange={(value) => set('prices', { [field]: value })}
                />
              ))}
            </div>
            {problems.includes('prices') && (
              <p role="alert" className="text-xs text-danger">
                {t('settings.ai.prices.invalid')}
              </p>
            )}
          </fieldset>
        </fieldset>
        {canManage && (
          <div>
            <button
              type="submit"
              className={PRIMARY_BUTTON_CLASS}
              disabled={!dirty || problems.length > 0}
            >
              {t('settings.ai.save')}
            </button>
          </div>
        )}
      </form>

      {saving && (
        <ReasonDialog
          title={t('settings.ai.saveTitle')}
          description={t('settings.ai.saveDescription')}
          requireTotp
          onConfirm={async ({ reason }) => {
            const after = await save.mutateAsync(requestOf(draft, reason));
            // The form starts again from what was stored: a typed key is gone from memory.
            setDraft(draftOf(after));
            onWarning(after.warning === 'reembed_required');
          }}
          onDone={() => setSaving(false)}
          onCancel={() => setSaving(false)}
        />
      )}

      <ConnectionTests canTest={canManage} />
      <Reembed settings={settings} canRun={canRun} />
    </>
  );
}

function PartFields({
  part,
  title,
  source,
  draft,
  last4,
  invalid,
  onChange,
  children,
}: {
  part: 'llm' | 'embedding';
  title: string;
  source: 'db' | 'env';
  draft: { choice: Choice; baseUrl: string; model: string; region: Region; key: KeyEdit };
  last4: string | null;
  invalid: boolean;
  onChange: (patch: Partial<AiDraft['llm']> & Partial<AiDraft['embedding']>) => void;
  children?: ReactNode;
}): ReactElement {
  const t = useTranslate();
  const id = (field: string) => `settings-ai-${part}-${field}`;
  const remote = draft.choice === 'openai';
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <p className="text-xs">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-medium',
            source === 'db' ? 'bg-brand-500/10 text-content-brand' : 'bg-surface-2 text-content',
          )}
        >
          {t(`settings.ai.source.${source}`)}
        </span>
      </p>
      <div>
        <label htmlFor={id('provider')} className="text-sm font-medium">
          {t('settings.ai.provider')}
        </label>
        <select
          id={id('provider')}
          value={draft.choice}
          onChange={(event) => onChange({ choice: event.target.value as Choice })}
          className={cn(FIELD_CLASS, 'max-w-sm')}
        >
          {(['env', 'mock', 'openai'] as const).map((choice) => (
            <option key={choice} value={choice}>
              {t(`settings.ai.provider.${choice}`)}
            </option>
          ))}
        </select>
      </div>
      {draft.choice !== 'env' && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField
              id={id('base-url')}
              label={t('settings.ai.baseUrl')}
              hint={t('settings.ai.baseUrl.hint')}
              value={draft.baseUrl}
              onChange={(value) => onChange({ baseUrl: value })}
            />
            <TextField
              id={id('model')}
              label={t('settings.ai.model')}
              value={draft.model}
              onChange={(value) => onChange({ model: value })}
            />
            <div>
              <label htmlFor={id('region')} className="text-sm font-medium">
                {t('settings.ai.region')}
              </label>
              <select
                id={id('region')}
                value={draft.region}
                onChange={(event) => onChange({ region: event.target.value as Region })}
                className={FIELD_CLASS}
              >
                {(['', 'eu', 'us'] as const).map((region) => (
                  <option key={region || 'none'} value={region}>
                    {t(`settings.ai.region.${region || 'none'}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {remote && (
            <ApiKeyField
              id={id('api-key')}
              last4={last4}
              edit={draft.key}
              onChange={(key) => onChange({ key })}
            />
          )}
          {invalid && (
            <p role="alert" className="text-xs text-danger">
              {t('settings.ai.required')}
            </p>
          )}
          {children}
        </>
      )}
    </fieldset>
  );
}

/** Write-only: never pre-filled, never shown back — "•••• last4" once stored. */
function ApiKeyField({
  id,
  last4,
  edit,
  onChange,
}: {
  id: string;
  last4: string | null;
  edit: KeyEdit;
  onChange: (key: KeyEdit) => void;
}): ReactElement {
  const t = useTranslate();
  const typing = edit.mode === 'replace' || (last4 === null && edit.mode !== 'remove');
  return (
    <div className="flex flex-col gap-1">
      {typing ? (
        <>
          <label htmlFor={id} className="text-sm font-medium">
            {t('settings.ai.apiKey')}
          </label>
          <div className="flex max-w-md gap-2">
            <input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={edit.value}
              onChange={(event) => onChange({ mode: 'replace', value: event.target.value })}
              aria-describedby={`${id}-hint`}
              className={FIELD_CLASS}
            />
            {last4 !== null && (
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => onChange({ mode: 'keep', value: '' })}
              >
                {t('settings.ai.apiKey.cancel')}
              </button>
            )}
          </div>
          <p id={`${id}-hint`} className="text-xs text-content-secondary">
            {last4 === null ? t('settings.ai.apiKey.none') : t('settings.ai.apiKey.hint')}
          </p>
          {edit.mode === 'replace' &&
            edit.value.trim().length > 0 &&
            edit.value.trim().length < 8 && (
              <p role="alert" className="text-xs text-danger">
                {t('settings.ai.apiKey.tooShort')}
              </p>
            )}
        </>
      ) : (
        <>
          <span className="text-sm font-medium">{t('settings.ai.apiKey')}</span>
          {edit.mode === 'remove' ? (
            <p className="text-sm">
              {t('settings.ai.apiKey.removing')}{' '}
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => onChange({ mode: 'keep', value: '' })}
              >
                {t('settings.ai.apiKey.undo')}
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">
                {t('settings.ai.apiKey.stored', { last4: last4 ?? '' })}
              </span>
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => onChange({ mode: 'replace', value: '' })}
              >
                {t('settings.ai.apiKey.change')}
              </button>
              <button
                type="button"
                className={SECONDARY_BUTTON_CLASS}
                onClick={() => onChange({ mode: 'remove', value: '' })}
              >
                {t('settings.ai.apiKey.remove')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  inputMode,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  inputMode?: 'numeric' | 'decimal';
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        {...(inputMode ? { inputMode } : {})}
        onChange={(event) => onChange(event.target.value)}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        className={FIELD_CLASS}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-content-secondary">
          {hint}
        </p>
      )}
    </div>
  );
}

function ConnectionTests({ canTest }: { canTest: boolean }): ReactElement | null {
  const t = useTranslate();
  const test = useTestAiConnection();
  const [target, setTarget] = useState<'llm' | 'embedding' | null>(null);
  const [result, setResult] = useState<PlatformAiConnectionTest | null>(null);
  if (!canTest) return null;
  return (
    <section aria-labelledby="settings-ai-test-title" className="flex flex-col gap-2">
      <h3 id="settings-ai-test-title" className="text-sm font-semibold">
        {t('settings.ai.test.title')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {(['llm', 'embedding'] as const).map((which) => (
          <button
            key={which}
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            onClick={() => setTarget(which)}
          >
            {t(`settings.ai.test.${which}`)}
          </button>
        ))}
      </div>
      <p role="status" className="text-sm">
        {result &&
          (result.ok
            ? t('settings.ai.test.ok', {
                target: t(`settings.ai.test.target.${result.target}`),
                ms: result.latency_ms,
                provider: result.provider,
                source: t(`settings.ai.source.${result.source}`),
              })
            : t('settings.ai.test.failed', {
                target: t(`settings.ai.test.target.${result.target}`),
                error: result.error ?? '—',
              }))}
      </p>
      {target && (
        <ReasonDialog
          title={t(`settings.ai.test.${target}`)}
          description={t('settings.ai.test.description')}
          onConfirm={async ({ reason }) => setResult(await test.mutateAsync({ reason, target }))}
          onDone={() => setTarget(null)}
          onCancel={() => setTarget(null)}
        />
      )}
    </section>
  );
}

function Reembed({
  settings,
  canRun,
}: {
  settings: PlatformAiSettings;
  canRun: boolean;
}): ReactElement {
  const t = useTranslate();
  const start = useStartReembed();
  const [open, setOpen] = useState(false);
  const run = settings.reembed;
  const counts = { sources: run.sources, chunks: run.chunks, failed: run.failed };
  return (
    <section aria-labelledby="settings-ai-reembed-title" className="flex flex-col gap-2">
      <h3 id="settings-ai-reembed-title" className="text-sm font-semibold">
        {t('settings.ai.reembed.title')}
      </h3>
      <p className="text-xs text-content-secondary">{t('settings.ai.reembed.description')}</p>
      <p className="text-sm" aria-live="polite">
        {run.state === 'finished'
          ? t('settings.ai.reembed.state.finished', {
              date: formatDate(run.finished_at) ?? '—',
              ...counts,
            })
          : t(`settings.ai.reembed.state.${run.state}`, counts)}
        {run.target && <> {t('settings.ai.reembed.target', { target: run.target })}</>}
      </p>
      {run.capped && <Banner tone="warning">{t('settings.ai.reembed.capped')}</Banner>}
      {canRun && (
        <div>
          <button
            type="button"
            className={SECONDARY_BUTTON_CLASS}
            disabled={run.state === 'running'}
            onClick={() => setOpen(true)}
          >
            {t('settings.ai.reembed.start')}
          </button>
        </div>
      )}
      {open && (
        <ReasonDialog
          title={t('settings.ai.reembed.start')}
          description={t('settings.ai.reembed.description')}
          onConfirm={({ reason }) => start.mutateAsync({ reason })}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      )}
    </section>
  );
}
