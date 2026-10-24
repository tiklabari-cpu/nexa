/**
 * The shell's notices about availability (WG-03 · tm 340.3): why the caller's
 * own status changed when they did not change it, and — for a team lead — a
 * chat nobody answered that is now waiting at the front of the queue.
 *
 * Fed by `lib/presence-notice.ts`, which `applyPush` writes from the socket. In
 * the shell rather than the inbox because neither is about the conversation on
 * screen: an agent paused while reading a report has to learn it there, and a
 * lead is usually not looking at the queue when it needs them.
 *
 * Every notice says what happened and offers the one way on: accept chats
 * again (never done for them — see `apps/rtm/src/presence.ts`), or open the
 * chat. A dismiss only hides it; nothing is undone.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import type { RoutingStatus } from '@siyahtus/types';
import { useAuth } from '../lib/auth-store.js';
import { useTranslate, type TFunction } from '../lib/i18n.js';
import {
  dismissSelfStatusNotice,
  dismissUnansweredAlert,
  usePresenceNotices,
  type SelfStatusNotice,
  type UnansweredAlert,
} from '../lib/presence-notice.js';
import { useSetRoutingStatus } from '../lib/routing-status.js';
import { Banner } from './ui/index.js';

const STATUS_LABEL_KEYS: Record<RoutingStatus, string> = {
  accepting_chats: 'inbox.rail.routing.accepting',
  not_accepting_chats: 'inbox.rail.routing.notAccepting',
  offline: 'inbox.rail.routing.offline',
};

/** "3 minutes" / "45 seconds" — the window a notice names. */
export function durationLabel(t: TFunction, seconds: number): string {
  return seconds % 60 === 0
    ? t('shell.presence.duration.minutes', { count: seconds / 60 })
    : t('shell.presence.duration.seconds', { count: seconds });
}

function selfMessage(t: TFunction, notice: SelfStatusNotice): string {
  switch (notice.kind) {
    case 'unresponsive':
      return notice.afterSeconds === null
        ? t('shell.presence.unresponsive.noDuration')
        : t('shell.presence.unresponsive', { duration: durationLabel(t, notice.afterSeconds) });
    case 'disconnected':
      return notice.afterSeconds === null
        ? t('shell.presence.disconnected.noDuration')
        : t('shell.presence.disconnected', { duration: durationLabel(t, notice.afterSeconds) });
    case 'changed_while_away':
      return t('shell.presence.changedWhileAway', {
        status: t(STATUS_LABEL_KEYS[notice.status]),
      });
  }
}

export function PresenceNotices(): ReactElement | null {
  const { self, alerts } = usePresenceNotices();
  if (!self && alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-border px-4 py-2">
      {self && <SelfNotice notice={self} />}
      {alerts.map((alert) => (
        <AlertNotice key={alert.id} alert={alert} />
      ))}
    </div>
  );
}

function SelfNotice({ notice }: { notice: SelfStatusNotice }): ReactElement {
  const t = useTranslate();
  const status = useAuth((s) => s.agent?.routing_status);
  const setRoutingStatus = useSetRoutingStatus();
  const [failed, setFailed] = useState(false);

  const acceptAgain = async (): Promise<void> => {
    setFailed(false);
    try {
      await setRoutingStatus('accepting_chats');
      dismissSelfStatusNotice();
    } catch {
      setFailed(true);
    }
  };

  return (
    <Banner
      tone="warning"
      title={t('shell.presence.title')}
      dismissible
      dismissLabel={t('shell.presence.dismiss')}
      onDismiss={dismissSelfStatusNotice}
      cta={
        status !== 'accepting_chats' && (
          <button
            type="button"
            onClick={() => void acceptAgain()}
            className="rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-content hover:bg-surface-2"
          >
            {t('shell.presence.acceptAgain')}
          </button>
        )
      }
    >
      <p>{selfMessage(t, notice)}</p>
      {failed && <p className="mt-1 text-danger">{t('shell.presence.acceptFailed')}</p>}
    </Banner>
  );
}

function AlertNotice({ alert }: { alert: UnansweredAlert }): ReactElement {
  const t = useTranslate();
  const queryClient = useQueryClient();
  // The shell's own roster (`PresenceAvatars`) is the one place a name for an
  // id is already held; the push carries ids only.
  const roster = queryClient.getQueryData<{ items: Array<{ id: string; name: string }> }>([
    'agents',
  ]);
  const agent =
    roster?.items.find((member) => member.id === alert.agentId)?.name ??
    t('shell.presence.alert.someone');

  return (
    <Banner
      tone="danger"
      role="status"
      title={t('shell.presence.alert.title')}
      dismissible
      dismissLabel={t('shell.presence.dismiss')}
      onDismiss={() => dismissUnansweredAlert(alert.id)}
      cta={
        <Link
          to={`/app/inbox?chat=${encodeURIComponent(alert.chatId)}`}
          onClick={() => dismissUnansweredAlert(alert.id)}
          className="inline-flex min-h-6 items-center rounded-md border border-border bg-surface px-3 py-1 text-xs font-medium text-content hover:bg-surface-2"
        >
          {t('shell.presence.alert.open')}
        </Link>
      }
    >
      <p>
        {alert.reason === 'transfer_limit'
          ? t('shell.presence.alert.transferLimit', { count: alert.transfers })
          : t('shell.presence.alert.noAgent', { agent })}
      </p>
    </Banner>
  );
}
