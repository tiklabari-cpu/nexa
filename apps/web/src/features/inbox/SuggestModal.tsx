/**
 * The transcript's two suggestions (tm 318.2 · SiyahTuş analysis AI-23):
 *
 *   - on one of the AI's messages, "AI'ı düzelt": why it was wrong — a wrong
 *     answer, it should have handed over, the tone — and an optional note;
 *   - on an agent's own message, "AI bilgisine öner": the answer, offered to
 *     the AI's knowledge. The server generalises it (names, usernames, amounts
 *     and dates come out) and the reviewers decide; nothing is live before a
 *     publication.
 *
 * The suggestion carries the last messages up to this one, masked by the
 * server, so the reviewer does not need the conversation. One mark per message
 * and kind (409), and fifty a day (429): the sentences come from the API.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { SUGGESTION_NOTE_MAX, type SuggestionKind } from '@siyahtus/types';
import { Banner, Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  AI_MESSAGE_MARKS,
  suggestionKeys,
  type AiSuggestion,
  type SuggestionSubject,
} from '../playbook/ai-suggestions.js';
import type { ChatEvent } from './types.js';

const button =
  'rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50';
const primaryButton =
  'rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50';

export function SuggestModal({
  event,
  subject,
  onClose,
}: {
  event: ChatEvent;
  subject: SuggestionSubject;
  onClose: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<SuggestionKind>(
    subject === 'ai_message' ? AI_MESSAGE_MARKS[0] : 'promote_agent_answer',
  );
  const [note, setNote] = useState('');

  const send = useMutation({
    mutationFn: () => {
      const trimmed = note.trim();
      return api.post<AiSuggestion>('/ai/suggestions', {
        chat_id: event.chat_id,
        thread_id: event.thread_id,
        event_id: event.id,
        kind,
        ...(trimmed ? { note: trimmed } : {}),
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: suggestionKeys.all }),
  });

  const offering = subject === 'agent_message';
  return (
    <Modal
      onClose={onClose}
      title={t(offering ? 'inbox.suggest.offerTitle' : 'inbox.suggest.fixTitle')}
      description={t(offering ? 'inbox.suggest.offerDescription' : 'inbox.suggest.fixDescription')}
      className="w-full max-w-md"
    >
      {send.isSuccess ? (
        <div className="flex flex-col gap-3">
          <Banner tone="success" role="status">
            {t(offering ? 'inbox.suggest.offerDone' : 'inbox.suggest.fixDone')}
          </Banner>
          <button type="button" className={`${button} self-end`} onClick={onClose}>
            {t('inbox.suggest.close')}
          </button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(submit) => {
            submit.preventDefault();
            send.mutate();
          }}
        >
          <blockquote className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-content-secondary">
            {event.text}
          </blockquote>

          {!offering && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-2xs font-medium text-content-secondary">
                {t('inbox.suggest.reason')}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {AI_MESSAGE_MARKS.map((mark) => (
                  <label
                    key={mark}
                    className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                      kind === mark
                        ? 'border-brand-500 bg-brand-500/10 font-medium text-content'
                        : 'border-border text-content-secondary hover:bg-surface-2'
                    }`}
                  >
                    <input
                      type="radio"
                      name="suggestion-kind"
                      value={mark}
                      checked={kind === mark}
                      onChange={() => setKind(mark)}
                      className="sr-only"
                    />
                    {t(`inbox.suggest.mark.${mark}`)}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <label className="flex flex-col gap-1 text-2xs text-content-secondary">
            {t('inbox.suggest.note')}
            <textarea
              value={note}
              rows={3}
              maxLength={SUGGESTION_NOTE_MAX}
              onChange={(change) => setNote(change.target.value)}
              className="resize-y rounded-md border border-border bg-surface px-2 py-1 text-xs text-content-primary"
            />
          </label>

          {send.isError && <Banner tone="danger">{t(errorMessageKey(send.error))}</Banner>}

          <div className="flex justify-end gap-2">
            <button type="button" className={button} onClick={onClose}>
              {t('inbox.suggest.cancel')}
            </button>
            <button type="submit" className={primaryButton} disabled={send.isPending}>
              {t(offering ? 'inbox.suggest.offerSend' : 'inbox.suggest.fixSend')}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
