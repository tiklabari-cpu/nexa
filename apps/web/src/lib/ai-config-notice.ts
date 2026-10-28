/**
 * The Inbox band's news (tm 316.4 · SiyahTuş analysis AI-20 · ADR-14b
 * §2.10 (3)): a version of the AI's configuration went live — an approval, a
 * rollback, or a scheduled publication whose time came. `ai_config_published`
 * reaches every agent of the workspace, because an agent reading a
 * conversation is the one who notices the AI answering differently.
 *
 * Only the latest one is held: two bands about two versions would leave the
 * reader working out which is live. A store rather than component state for
 * the reason `presence-notice.ts` is one — the push lands in `applyPush`,
 * outside React.
 */
import { create } from 'zustand';
import type { AiConfigPublishedPush } from '@siyahtus/types';

interface AiConfigNoticeState {
  published: AiConfigPublishedPush | null;
}

const useStore = create<AiConfigNoticeState>(() => ({ published: null }));

export function useAiConfigNotice(): AiConfigPublishedPush | null {
  return useStore((state) => state.published);
}

/** Reads the push's payload; one that does not hold together is dropped. */
export function readAiConfigPublished(
  payload: Record<string, unknown>,
): AiConfigPublishedPush | null {
  const { ai_agent_id, version_id, label, seq, published_at, rollback_of } = payload;
  if (typeof ai_agent_id !== 'string' || typeof version_id !== 'string') return null;
  if (typeof label !== 'string' || typeof seq !== 'number') return null;
  if (typeof published_at !== 'string') return null;
  if (rollback_of !== null && typeof rollback_of !== 'string') return null;
  return { ai_agent_id, version_id, label, seq, published_at, rollback_of };
}

/** A later publication replaces an earlier one; a stale replay of an older one does not. */
export function noteAiConfigPublished(push: AiConfigPublishedPush): void {
  useStore.setState((state) =>
    state.published && state.published.seq > push.seq ? state : { published: push },
  );
}

export function dismissAiConfigNotice(): void {
  useStore.setState({ published: null });
}

/** For tests, and for a sign-out. */
export function resetAiConfigNotice(): void {
  useStore.setState({ published: null });
}
