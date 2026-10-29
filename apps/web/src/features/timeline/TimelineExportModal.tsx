/**
 * The timeline's download (ID-09 · tm 334.2): `POST /chats/{chatId}/timeline/export`,
 * a CSV, NDJSON or plain-text file of the whole day or connection — not only the
 * rows the screen is filtered to. Masked unless the person unticks it, and only
 * the Founder can (`timeline.export_unmasked`); the server refuses anyone else,
 * so the box is disabled for them rather than offered and refused.
 */
import { useState, type ReactElement } from 'react';
import {
  TIMELINE_EXPORT_FORMATS,
  TIMELINE_EXPORT_MAX,
  type TimelineExportFormat,
} from '@siyahtus/types';
import { Banner, Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatCount } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

export function TimelineExportModal({
  chatId,
  threadId,
  canExportUnmasked,
  onClose,
}: {
  chatId: string;
  /** The connection the screen is scoped to; null = the whole day. */
  threadId: string | null;
  canExportUnmasked: boolean;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [format, setFormat] = useState<TimelineExportFormat>('csv');
  const [mask, setMask] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const { blob, filename } = await api.postFile(
        `/chats/${encodeURIComponent(chatId)}/timeline/export`,
        {
          format,
          ...(threadId !== null ? { thread_id: threadId } : {}),
          mask_pii: mask,
        },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      // The server names the file after the day (and connection); its name is the evidence's.
      link.download = filename ?? `siyahtus-timeline-${chatId}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      onClose();
    } catch (cause) {
      setError(t(errorMessageKey(cause)));
      setPending(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={t('timeline.export.title')}
      description={t('timeline.export.description', {
        scope: t(threadId !== null ? 'timeline.export.scopeThread' : 'timeline.export.scopeDay'),
        max: formatCount(TIMELINE_EXPORT_MAX) ?? String(TIMELINE_EXPORT_MAX),
      })}
      className="w-full max-w-md"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(submit) => {
          submit.preventDefault();
          void download();
        }}
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-2xs font-medium text-content-secondary">
            {t('timeline.export.format')}
          </legend>
          {TIMELINE_EXPORT_FORMATS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="timeline-export-format"
                value={option}
                checked={format === option}
                onChange={() => setFormat(option)}
              />
              <span>{t(`timeline.export.format.${option}`)}</span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={mask}
              disabled={!canExportUnmasked}
              onChange={(change) => setMask(change.target.checked)}
            />
            <span>{t('timeline.export.mask')}</span>
          </label>
          <p className="text-2xs text-content-tertiary">
            {canExportUnmasked ? t('timeline.export.maskHint') : t('timeline.export.maskLocked')}
          </p>
        </div>

        <p className="text-2xs text-content-tertiary">{t('timeline.export.audited')}</p>

        {error && (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>
            {t('timeline.export.cancel')}
          </button>
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending ? t('timeline.export.preparing') : t('timeline.export.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
