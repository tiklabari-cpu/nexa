/**
 * The archive's transcript actions (AR-04 · tm 338): download the text file,
 * open the print view (the browser saves it as a PDF) and email the player's
 * copy.
 *
 * Who sees which (AR-04-S1, the matrix's `transcripts.export`): a person the
 * row reaches downloads and prints either copy and emails to the player or an
 * allowed domain; below it, the person who had the connection can only email
 * the player's copy to the player's registered address. The server decides —
 * a connection outside the row's reach answers 404, an address outside the
 * workspace's domains `recipient_not_allowed` — and the dialogs show its answer.
 */
import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TRANSCRIPT_AUDIENCES,
  type ArchiveConversationDetail,
  type TranscriptAudience,
} from '@siyahtus/types';
import { Banner, Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { transcriptFileUrl, transcriptPrintAddress } from './transcript.js';

const actionButton =
  'rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2';
const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

type Dialog = 'download' | 'print' | 'email';

export function TranscriptActions({
  detail,
}: {
  detail: ArchiveConversationDetail;
}): ReactElement | null {
  const t = useTranslate();
  const level = useAuth((s) => s.agent?.capabilities?.['transcripts.export']);
  const me = useAuth((s) => s.agent?.account_id ?? null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const canExport = level !== 'none';
  const ownConnection = me !== null && detail.assignee?.id === me;
  if (!canExport && !ownConnection) return null;

  return (
    <>
      {canExport && (
        <>
          <button type="button" className={actionButton} onClick={() => setDialog('download')}>
            {t('archive.transcript.download')}
          </button>
          <button type="button" className={actionButton} onClick={() => setDialog('print')}>
            {t('archive.transcript.print')}
          </button>
        </>
      )}
      <button type="button" className={actionButton} onClick={() => setDialog('email')}>
        {t('archive.transcript.email')}
      </button>
      {(dialog === 'download' || dialog === 'print') && (
        <TranscriptExportDialog detail={detail} mode={dialog} onClose={() => setDialog(null)} />
      )}
      {dialog === 'email' && (
        <TranscriptEmailDialog
          detail={detail}
          playerOnly={!canExport}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

function TranscriptExportDialog({
  detail,
  mode,
  onClose,
}: {
  detail: ArchiveConversationDetail;
  mode: 'download' | 'print';
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const navigate = useNavigate();
  const [copy, setCopy] = useState<TranscriptAudience>('customer');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (mode === 'print') {
      navigate(transcriptPrintAddress(detail.chat_id, detail.thread_id, copy));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { blob, filename } = await api.getFile(
        transcriptFileUrl(detail.chat_id, detail.thread_id, 'txt', copy),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? `siyahtus-transcript-${detail.thread_id}.txt`;
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
      title={t(
        mode === 'print' ? 'archive.transcript.printTitle' : 'archive.transcript.downloadTitle',
      )}
      description={t(
        mode === 'print'
          ? 'archive.transcript.printDescription'
          : 'archive.transcript.downloadDescription',
      )}
      className="w-full max-w-md"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-2xs font-medium text-content-secondary">
            {t('archive.transcript.copy.legend')}
          </legend>
          {TRANSCRIPT_AUDIENCES.map((option) => (
            <label key={option} className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="transcript-copy"
                value={option}
                checked={copy === option}
                onChange={() => setCopy(option)}
              />
              <span>{t(`archive.transcript.copy.${option}`)}</span>
            </label>
          ))}
        </fieldset>

        <p className="text-2xs text-content-tertiary">{t('archive.transcript.audited')}</p>

        {error && (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={button} onClick={onClose}>
            {t('archive.transcript.cancel')}
          </button>
          <button type="submit" className={primaryButton} disabled={pending}>
            {pending
              ? t('archive.transcript.preparing')
              : t(
                  mode === 'print'
                    ? 'archive.transcript.submitPrint'
                    : 'archive.transcript.submitDownload',
                )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TranscriptEmailDialog({
  detail,
  playerOnly,
  onClose,
}: {
  detail: ArchiveConversationDetail;
  /** The caller may only send to the player's registered address. */
  playerOnly: boolean;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [target, setTarget] = useState<'player' | 'other'>('player');
  const [address, setAddress] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      const body = target === 'other' ? { to: address.trim(), audience: 'customer' } : {};
      const chat = encodeURIComponent(detail.chat_id);
      const thread = encodeURIComponent(detail.thread_id);
      await api.post(`/chats/${chat}/threads/${thread}/transcript/email`, body);
      setSent(true);
    } catch (cause) {
      setError(t(errorMessageKey(cause)));
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={t('archive.transcript.emailTitle')}
      description={t('archive.transcript.emailDescription')}
      className="w-full max-w-md"
    >
      {sent ? (
        <div className="flex flex-col gap-4">
          <Banner tone="success" role="status">
            {t('archive.transcript.sent')}
          </Banner>
          <div className="flex justify-end">
            <button type="button" className={primaryButton} onClick={onClose}>
              {t('archive.transcript.close')}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-2xs font-medium text-content-secondary">
              {t('archive.transcript.recipient.legend')}
            </legend>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="transcript-recipient"
                value="player"
                checked={target === 'player'}
                onChange={() => setTarget('player')}
              />
              <span>{t('archive.transcript.recipient.player')}</span>
            </label>
            {!playerOnly && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name="transcript-recipient"
                  value="other"
                  checked={target === 'other'}
                  onChange={() => setTarget('other')}
                />
                <span>{t('archive.transcript.recipient.other')}</span>
              </label>
            )}
          </fieldset>

          {target === 'other' && (
            <div className="flex flex-col gap-1">
              <label htmlFor="transcript-recipient-address" className="text-xs font-medium">
                {t('archive.transcript.recipient.address')}
              </label>
              <input
                id="transcript-recipient-address"
                type="email"
                required
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="off"
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
              />
              <p className="text-2xs text-content-tertiary">
                {t('archive.transcript.recipient.otherHint')}
              </p>
            </div>
          )}
          {playerOnly && (
            <p className="text-2xs text-content-tertiary">
              {t('archive.transcript.recipient.playerOnly')}
            </p>
          )}

          <p className="text-2xs text-content-tertiary">{t('archive.transcript.audited')}</p>

          {error && (
            <Banner tone="danger" role="alert">
              {error}
            </Banner>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={onClose}>
              {t('archive.transcript.cancel')}
            </button>
            <button
              type="submit"
              className={primaryButton}
              disabled={pending || (target === 'other' && address.trim() === '')}
            >
              {pending ? t('archive.transcript.sending') : t('archive.transcript.send')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
