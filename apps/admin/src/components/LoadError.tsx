import type { ReactElement } from 'react';
import { errorMessageKey, isForbidden } from '../lib/api-client.js';
import { useTranslate } from '../lib/i18n.js';

/**
 * A list whose read failed (apps/web, tm 259.6). One pattern for every list: loading, then this
 * (`role="alert"` + the error's own sentence + "Try again"), then the empty state, then the
 * rows. A failed read must never fall through to "nothing here yet".
 *
 * The sentence comes from `common.errors.*` through `errorMessageKey`, so offline, a 429 and a
 * 500 do not all read the same. A 403 `authorization` is not a failure to retry but the server
 * saying this role does not open the page — hiding it behind the menu was courtesy, this is the
 * rule — so it reads as the "no access" screen and offers no retry (tm 389.6).
 */
export function LoadError({
  title,
  error,
  onRetry,
  compact = false,
}: {
  /** What could not be loaded, in the caller's words ("Workspaces couldn't be loaded"). */
  title: string;
  error: unknown;
  onRetry: () => void;
  /** For a small popover or side panel, where the page-sized padding would swallow it. */
  compact?: boolean;
}): ReactElement {
  const t = useTranslate();
  const forbidden = isForbidden(error);
  return (
    <div
      role="alert"
      className={`flex flex-1 flex-col items-center justify-center gap-2 text-center ${
        compact ? 'p-2' : 'p-8'
      }`}
    >
      <p className={compact ? 'text-xs font-medium' : 'text-base font-medium'}>
        {forbidden ? t('shell.forbidden.title') : title}
      </p>
      <p className={`max-w-xs text-content-secondary ${compact ? 'text-2xs' : 'text-sm'}`}>
        {forbidden ? t('shell.forbidden.serverDescription') : t(errorMessageKey(error))}
      </p>
      {!forbidden && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-inset px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:text-content"
        >
          {t('common.loadError.retry')}
        </button>
      )}
    </div>
  );
}
