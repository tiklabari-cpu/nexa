/**
 * The Copilot → composer hand-off store (FR-MOD-12.3 / 13.7-i) — the mobile
 * counterpart of `apps/web/src/features/inbox/copilotDraft.test.ts`.
 */
import { clearCopilotDraft, copilotDraftStore, offerDraft } from './copilotDraft';

beforeEach(() => {
  clearCopilotDraft('CHAT1');
  clearCopilotDraft('CHAT2');
});

describe('copilotDraft store', () => {
  it('offers a draft for a specific chat', () => {
    offerDraft('CHAT1', 'a suggested reply');
    expect(copilotDraftStore.getDraft('CHAT1')).toBe('a suggested reply');
    expect(copilotDraftStore.getDraft('CHAT2')).toBeUndefined();
  });

  it('clears a consumed draft without touching the others', () => {
    offerDraft('CHAT1', 'one');
    offerDraft('CHAT2', 'two');
    clearCopilotDraft('CHAT1');
    expect(copilotDraftStore.getDraft('CHAT1')).toBeUndefined();
    expect(copilotDraftStore.getDraft('CHAT2')).toBe('two');
  });

  it('replaces an earlier draft for the same chat', () => {
    offerDraft('CHAT1', 'first');
    offerDraft('CHAT1', 'second');
    expect(copilotDraftStore.getDraft('CHAT1')).toBe('second');
  });

  it('notifies subscribers when a draft is pushed or cleared', () => {
    const listener = jest.fn();
    const unsubscribe = copilotDraftStore.subscribe(listener);

    offerDraft('CHAT1', 'a suggested reply');
    expect(listener).toHaveBeenCalledTimes(1);

    clearCopilotDraft('CHAT1');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    offerDraft('CHAT1', 'ignored after unsubscribe');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when clearing a chat with no pending draft', () => {
    const listener = jest.fn();
    copilotDraftStore.subscribe(listener);

    clearCopilotDraft('CHAT-NEVER-OFFERED');
    expect(listener).not.toHaveBeenCalled();
  });
});
