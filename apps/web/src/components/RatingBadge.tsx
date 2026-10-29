/**
 * The player's rating of a connection, and its comment (AR-03 · WG-11): one
 * look wherever a rating is shown — the archive's rows and detail, the Inbox's
 * Details panel, the Reviews comments.
 *
 * The badge is an icon and words, never a colour alone: "Rated bad (with a
 * comment)". The comment is the player's own words, rendered as text — never
 * as HTML — and a long one is shortened until asked for in full.
 */
import { useState, type ReactElement } from 'react';
import type { RatingValue } from '@siyahtus/types';
import { useTranslate } from '../lib/i18n.js';

/** Characters a comment shows before "Show all". */
export const RATING_COMMENT_PREVIEW = 160;

export function RatingBadge({
  value,
  hasComment,
  className = '',
}: {
  value: RatingValue;
  hasComment: boolean;
  className?: string;
}): ReactElement {
  const t = useTranslate();
  const key = hasComment ? `archive.rating.${value}Commented` : `archive.rating.${value}`;
  return (
    <span
      data-testid="rating-badge"
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm bg-inset px-1.5 py-0.5 text-2xs ${
        value === 'bad' ? 'text-danger' : 'text-success'
      } ${className}`}
    >
      <span aria-hidden="true">{value === 'bad' ? '👎' : '👍'}</span>
      <span>{t(key)}</span>
    </span>
  );
}

/** The comment, plain text; past {@link RATING_COMMENT_PREVIEW} characters, shortened until opened. */
export function RatingComment({ comment }: { comment: string }): ReactElement {
  const t = useTranslate();
  const [open, setOpen] = useState(false);
  const chars = Array.from(comment);
  const long = chars.length > RATING_COMMENT_PREVIEW;
  const shown =
    long && !open ? `${chars.slice(0, RATING_COMMENT_PREVIEW).join('').trimEnd()}…` : comment;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <q
        data-testid="rating-comment"
        className="whitespace-pre-wrap break-words text-2xs text-content-secondary before:content-none after:content-none"
      >
        {shown}
      </q>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="text-2xs text-content-brand underline underline-offset-2"
        >
          {open ? t('archive.rating.comment.less') : t('archive.rating.comment.more')}
        </button>
      )}
    </span>
  );
}
