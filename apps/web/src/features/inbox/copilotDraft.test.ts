/**
 * The Copilot → composer hand-off store (FR-MOD-12.3).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { offerDraft, useCopilotDraftStore } from './copilotDraft.js';

beforeEach(() => {
  useCopilotDraftStore.setState({ byChat: {} });
});

describe('copilotDraft store', () => {
  it('offers a draft for a specific chat', () => {
    offerDraft('CHAT1', 'a suggested reply');
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBe('a suggested reply');
    expect(useCopilotDraftStore.getState().byChat['CHAT2']).toBeUndefined();
  });

  it('clears a consumed draft without touching the others', () => {
    offerDraft('CHAT1', 'one');
    offerDraft('CHAT2', 'two');
    useCopilotDraftStore.getState().clear('CHAT1');
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBeUndefined();
    expect(useCopilotDraftStore.getState().byChat['CHAT2']).toBe('two');
  });

  it('replaces an earlier draft for the same chat', () => {
    offerDraft('CHAT1', 'first');
    offerDraft('CHAT1', 'second');
    expect(useCopilotDraftStore.getState().byChat['CHAT1']).toBe('second');
  });
});
