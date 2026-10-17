/**
 * The AI mode state machine (tm 293.1 · AI-11 §1) — the edges, and the words
 * the transcript gets for each change. The writes themselves and the race they
 * settle live in `test/integration/ai-mode-gate.test.ts`.
 */
import { AI_CONVERSATION_MODES, AI_MODE_REASONS } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { aiMayAnswer, aiModeNoteText, aiModeStep } from './ai-mode.js';

describe('the AI mode state machine (AI-11)', () => {
  it('lets anybody hand a connection to a person, from every mode', () => {
    expect(aiModeStep(null, 'human')).toBe('change');
    expect(aiModeStep('ai', 'human')).toBe('change');
    expect(aiModeStep('paused', 'human')).toBe('change');
    expect(aiModeStep('human', 'human')).toBe('same');
  });

  it('gives a connection to the AI from nobody, a person or a pause — and from nowhere else', () => {
    expect(aiModeStep(null, 'ai')).toBe('change');
    expect(aiModeStep('human', 'ai')).toBe('change');
    expect(aiModeStep('paused', 'ai')).toBe('change');
    expect(aiModeStep('ai', 'ai')).toBe('same');
  });

  it('pauses only an AI that is answering', () => {
    expect(aiModeStep('ai', 'paused')).toBe('change');
    expect(aiModeStep('paused', 'paused')).toBe('same');
    // Nothing to hold back where the AI never spoke, or where a person has it.
    expect(aiModeStep(null, 'paused')).toBe('refused');
    expect(aiModeStep('human', 'paused')).toBe('refused');
  });

  it('decides every pair of modes, none left undefined', () => {
    for (const from of [null, ...AI_CONVERSATION_MODES]) {
      for (const to of AI_CONVERSATION_MODES) {
        expect(['change', 'same', 'refused']).toContain(aiModeStep(from, to));
      }
    }
  });

  it('lets the AI answer only a connection nobody has yet, or one that is its own', () => {
    expect(aiMayAnswer(null)).toBe(true);
    expect(aiMayAnswer('ai')).toBe(true);
    expect(aiMayAnswer('human')).toBe(false);
    expect(aiMayAnswer('paused')).toBe(false);
  });

  it('words each change for the transcript, never the bare reason code', () => {
    expect(aiModeNoteText({ to: 'human', reason: 'agent_message' })).toBe(
      'AI stopped: an agent replied',
    );
    expect(aiModeNoteText({ to: 'human', reason: 'ai_handoff' })).toBe('AI handed the chat over');
    expect(aiModeNoteText({ to: 'ai', reason: 'return_to_ai' })).toBe('AI answering again');
    expect(aiModeNoteText({ to: 'paused', reason: 'pause' })).toBe('AI paused');
    for (const reason of AI_MODE_REASONS) {
      const text = aiModeNoteText({ to: 'human', reason });
      expect(text).toMatch(/^AI /);
      expect(text).not.toMatch(/_/);
    }
  });
});
