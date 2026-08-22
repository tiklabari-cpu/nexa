/**
 * Who else is on shift, in the shell's rail (FR-MOD-01.1.4).
 *
 * The requirement asks for the licence's online teammates with an
 * online/offline ring and their name on hover. Three decisions are worth
 * writing down.
 *
 * **Where it lives.** The PRD's observation put this in a top bar; this product
 * has none — its persistent chrome is the left rail, with the two notice strips
 * (sandbox, trial) above it. Inventing a top bar to hold four avatars would add
 * a horizontal band to every screen for one secondary signal, so the group sits
 * in the rail's footer instead, directly above the account avatar: "who else is
 * here" next to "who I am".
 *
 * **Where the state comes from.** The licence roster is read from the shared
 * `['agents']` key — the same cache the ticket pane's follower picker uses, so
 * the app makes one request for it — and kept live by the RTM
 * `routing_status_set` push, which `applyPush` (`features/inbox/useInbox.ts`)
 * folds into that cache. No new RTM action was opened: `routing_status_set` was
 * already subscribed to and already broadcast to every agent in the licence
 * (`allAgents` audience, `apps/api/src/routes/agents.ts`); until now the shell
 * simply had nothing that consumed it. The socket is opened by the Inbox module
 * alone, so on the other routes nothing is pushing — hence the 30 s refetch
 * underneath, which is the polling fallback the task allowed and the only
 * reason it is here.
 *
 * **Status is never colour alone (NFR-A11Y2).** Two states are shown at once —
 * accepting chats and online-but-away — and telling them apart by a green vs
 * amber ring would fail exactly the people the requirement is written for. Each
 * avatar carries a glyph badge (● / ◐, the `StatusDot` alphabet) and states its
 * status in its accessible name, so the ring is the third signal rather than
 * the only one.
 */
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import type { RoutingStatus } from '@nexa/types';
import { useApiClient, useAuth } from '../lib/auth-store.js';
import { useTranslate, type TFunction } from '../lib/i18n.js';

/** Faces shown before the rest collapse into a single "+N". */
const VISIBLE = 4;

/** Presence is a background signal; it must not out-poll anything on screen. */
const POLL_MS = 30_000;

/**
 * The slice of a `GET /agents` row this needs.
 *
 * Declared here rather than imported from `features/inbox/types.ts` so the
 * shell's own chrome does not depend on a feature module for its shape; both
 * describe the same response, and the fields below are the ones presence reads.
 */
interface PresenceMember {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  routing_status: RoutingStatus;
}

/** A teammate is *present* in either of these; `offline` is the absence. */
type OnlineStatus = Exclude<RoutingStatus, 'offline'>;

const STATUS_GLYPH: Record<OnlineStatus, string> = {
  accepting_chats: '●',
  not_accepting_chats: '◐',
};

const STATUS_RING: Record<OnlineStatus, string> = {
  accepting_chats: 'ring-success',
  not_accepting_chats: 'ring-warning',
};

const STATUS_TEXT: Record<OnlineStatus, string> = {
  accepting_chats: 'text-success',
  not_accepting_chats: 'text-warning',
};

const STATUS_KEY: Record<OnlineStatus, string> = {
  accepting_chats: 'shell.presence.accepting',
  not_accepting_chats: 'shell.presence.away',
};

/** Same derivation as the account menu's own avatar, so the two agree. */
function initialsOf(member: PresenceMember): string {
  return (member.name || member.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function displayName(member: PresenceMember): string {
  return member.name || member.email;
}

function memberLabel(t: TFunction, member: PresenceMember, status: OnlineStatus): string {
  return t('shell.presence.member', {
    name: displayName(member),
    status: t(STATUS_KEY[status]),
  });
}

export function PresenceAvatars({ pinned }: { pinned: boolean }): ReactElement | null {
  const api = useApiClient();
  const t = useTranslate();
  const selfId = useAuth((s) => s.agent?.account_id);

  const { data } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<{ items: PresenceMember[] }>('/agents'),
    // A caller the route refuses gets no avatar group rather than a retry
    // storm — the same shape `TrialBanner` uses for its billing read.
    retry: false,
    refetchInterval: POLL_MS,
  });

  // `GET /agents` already excludes suspended memberships (its `status` defaults
  // to `active`), which matters here: suspension deliberately leaves
  // `routing_status` alone (`membership-service.ts`), so a suspended teammate
  // still reads `accepting_chats` and would otherwise be shown as on shift.
  const online = (data?.items ?? []).flatMap((member) =>
    member.id !== selfId && member.routing_status !== 'offline'
      ? [{ member, status: member.routing_status as OnlineStatus }]
      : [],
  );

  // Nothing to say rather than an empty frame (FR-EK-B.1). The signed-in agent
  // is excluded above: their own face is already the account trigger below this.
  if (online.length === 0) return null;

  const shown = online.slice(0, VISIBLE);
  const overflow = online.slice(VISIBLE);
  const overflowNames = overflow.map(({ member }) => displayName(member)).join(', ');

  return (
    <ul
      aria-label={t('shell.presence.label')}
      data-testid="presence-avatars"
      className={`mb-2 flex ${pinned ? '-space-x-1.5 px-1' : '-space-y-1.5 flex-col items-center'}`}
    >
      {shown.map(({ member, status }) => {
        const label = memberLabel(t, member, status);
        return (
          <li key={member.id} className="relative">
            <span
              role="img"
              aria-label={label}
              title={label}
              className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/10 text-2xs font-semibold text-white ring-2 ${STATUS_RING[status]}`}
            >
              {member.avatar_url ? (
                <img src={member.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                initialsOf(member)
              )}
            </span>
            <span
              aria-hidden="true"
              className={`absolute -bottom-1 -right-0.5 text-2xs leading-none ${STATUS_TEXT[status]}`}
            >
              {STATUS_GLYPH[status]}
            </span>
          </li>
        );
      })}

      {overflow.length > 0 && (
        <li className="relative">
          <span
            role="img"
            // The names are what make "+3" answerable rather than merely
            // countable — to a pointer (title) and to a screen reader alike.
            aria-label={t('shell.presence.more', {
              count: overflow.length,
              names: overflowNames,
            })}
            title={overflowNames}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-2xs font-semibold text-white ring-2 ring-white/20"
          >
            +{overflow.length}
          </span>
        </li>
      )}
    </ul>
  );
}
