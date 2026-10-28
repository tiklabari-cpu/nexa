/**
 * The inbox's "QA'ya gönder" (tm 319.3 · SiyahTuş analysis AI-24): a Team
 * Lead or an administrator sends the newest connection of the open
 * conversation to the QA queue by hand, with an optional note the reviewer
 * reads (kept masked, as the review's comment until the reviewer writes one).
 *
 * The API decides what may go: a closed connection the AI took part in, of a
 * team the lead leads; already queued, it joins as `manual`; already
 * reviewed, it is refused — each with its own sentence here.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { QA_MANUAL_NOTE_MAX } from '@siyahtus/types';
import { CopyId } from '../../components/CopyId.js';
import { Banner, Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { qaErrorKey, qaKeys, qaReviewHref, type QaReviewDetail } from '../reports/qa/qa.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

export function SendToQaModal({
  chatId,
  threadId,
  onClose,
}: {
  chatId: string;
  threadId: string;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  const send = useMutation({
    mutationFn: () => {
      const trimmed = note.trim();
      return api.post<QaReviewDetail>('/qa/reviews', {
        chat_id: chatId,
        thread_id: threadId,
        ...(trimmed ? { note: trimmed } : {}),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qaKeys.all }),
  });

  return (
    <Modal
      onClose={onClose}
      title={t('inbox.qa.title')}
      description={t('inbox.qa.description')}
      className="w-full max-w-md"
    >
      {send.isSuccess ? (
        <div className="flex flex-col gap-3">
          <Banner tone="success" role="status">
            {t('inbox.qa.done')}
          </Banner>
          <div className="flex justify-end gap-2">
            <Link to={qaReviewHref(send.data.id)} className={button}>
              {t('inbox.qa.openReview')}
            </Link>
            <button type="button" className={button} onClick={onClose}>
              {t('inbox.qa.close')}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(submit) => {
            submit.preventDefault();
            send.mutate();
          }}
        >
          <CopyId kind="chat" value={threadId} />
          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('inbox.qa.note')}
            <textarea
              value={note}
              rows={3}
              maxLength={QA_MANUAL_NOTE_MAX}
              onChange={(change) => setNote(change.target.value)}
              className="resize-y rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary"
            />
          </label>

          {send.isError && (
            <Banner tone="danger">
              {t(qaErrorKey(send.error) ?? errorMessageKey(send.error))}
            </Banner>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={onClose}>
              {t('inbox.qa.cancel')}
            </button>
            <button type="submit" className={primaryButton} disabled={send.isPending}>
              {t('inbox.qa.send')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
