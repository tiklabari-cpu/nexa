import type { ReactElement } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import { Composer } from './Composer.js';
import { ReplyClaimBar, useReplyClaim } from './ReplyClaimBar.js';
import type { ChatDetail } from './types.js';

/**
 * The composer, and above it the strip that says why Reply will not send when
 * the open connection is not the caller's (tm 475.4 · `ReplyClaimBar`).
 */
export function ReplyArea({
  chatId,
  chat,
  transcriptFailed,
}: {
  chatId: string;
  chat: ChatDetail;
  transcriptFailed: boolean;
}): ReactElement {
  const t = useTranslate();
  const claim = useReplyClaim(chat);
  const open = chat.active && !transcriptFailed;
  return (
    <>
      {open && claim.kind !== 'mine' && <ReplyClaimBar chatId={chatId} claim={claim} />}
      {/* Keyed on the open chat (tm 277.1): the text, attachment, mode and
      chips are this component's state, and without the key a switch to a chat
      already in the cache kept them — what was written to A sat in B's box,
      one Enter from B. */}
      <Composer
        key={chatId}
        chatId={chatId}
        disabled={!chat.active || transcriptFailed}
        {...(chat.active && transcriptFailed
          ? { disabledNotice: t('inbox.composer.unavailableNotice') }
          : {})}
        replyLocked={claim.kind !== 'mine'}
        tags={chat.thread?.tags ?? []}
      />
    </>
  );
}
