/**
 * "My sessions" (tm 391 · FR-ADMIN-02): the operator's own live sessions — when each started,
 * when it was last used, from which address and browser — with the current one marked, and a
 * button that ends every other. Nothing here can end the session in use; signing out does that.
 * The server never sends a session's token, only its clocks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Modal } from '../../components/ui/Modal.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { api } from '../../lib/auth-store.js';
import { formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformEndedCount, PlatformSessionList } from '../../lib/platform-types.js';
import {
  Cell,
  DataTable,
  EmptyLine,
  Loading,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
} from '../workspaces/ui.js';

const SESSIONS_KEY = ['account', 'sessions'] as const;

export function SessionsDialog({ onClose }: { onClose: () => void }): ReactElement {
  const t = useTranslate();
  const client = useQueryClient();
  const [ended, setEnded] = useState<number | null>(null);
  const query = useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: () => api.get<PlatformSessionList>('/auth/sessions'),
    staleTime: 0,
  });
  const endOthers = useMutation({
    mutationFn: () => api.delete<PlatformEndedCount>('/auth/sessions'),
    onSuccess: async (result) => {
      setEnded(result.ended);
      await client.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const sessions = query.data?.data ?? [];
  const others = sessions.filter((session) => !session.current).length;

  return (
    <Modal
      onClose={onClose}
      title={t('shell.account.sessions.title')}
      description={t('shell.account.sessions.body')}
      // `text-content`: the menu that opens this sits in the amber strip, whose text colour the
      // dialog would otherwise inherit (dark text on the dark theme's panel — 1.01:1).
      // A wide panel, scrolled inside the viewport: every sign-in is a session, and a long list must
      // not push the buttons below it out of reach. (`!`: the Modal's own `max-w-md` is not merged.)
      className="max-h-full !max-w-3xl overflow-y-auto text-content"
    >
      <div className="flex flex-col gap-4">
        {query.isError ? (
          <LoadError
            compact
            title={t('shell.account.sessions.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <Loading label={t('shell.account.sessions.loading')} />
        ) : sessions.length === 0 ? (
          <EmptyLine>{t('shell.account.sessions.empty')}</EmptyLine>
        ) : (
          <DataTable
            caption={t('shell.account.sessions.title')}
            headers={[
              t('shell.account.sessions.col.started'),
              t('shell.account.sessions.col.lastSeen'),
              t('shell.account.sessions.col.ip'),
              t('shell.account.sessions.col.browser'),
            ]}
          >
            {sessions.map((session) => (
              <tr key={session.id}>
                <Cell>
                  {formatDateTime(session.created_at)}
                  {session.current && (
                    <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-2xs font-semibold">
                      {t('shell.account.sessions.current')}
                    </span>
                  )}
                </Cell>
                <Cell>{formatDateTime(session.last_seen_at)}</Cell>
                <Cell>{session.ip}</Cell>
                <Cell>
                  <span className="break-all text-xs">{session.user_agent}</span>
                </Cell>
              </tr>
            ))}
          </DataTable>
        )}
        {ended !== null && (
          <p role="status" className="text-sm text-success">
            {t('shell.account.sessions.ended', { count: ended })}
          </p>
        )}
        {endOthers.isError && (
          <p role="alert" className="text-sm text-danger">
            {t(errorMessageKey(endOthers.error))}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
            {t('shell.account.sessions.close')}
          </button>
          <button
            type="button"
            disabled={others === 0 || endOthers.isPending}
            onClick={() => endOthers.mutate()}
            className={PRIMARY_BUTTON_CLASS}
          >
            {t('shell.account.sessions.endOthers')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
