/**
 * The agent's view of the AI's state (tm 296.4 · AI-03 §13, AI-04 "AI'ın
 * topladıkları") — what `GET /chats/{chatId}/ai-conversation` and a preview's
 * `state` return.
 */
import { describe, expect, it } from 'vitest';
import { validateProcedure, type Procedure } from '@siyahtus/types';
import { conversationView } from './conversation-view.js';
import { procedureHash } from './procedure/executor.js';
import { emptyTurnState, type TurnState } from './turn.js';

function procedure(slots: unknown[]): Procedure {
  const result = validateProcedure({
    when_to_use: 'Yatırım geçmedi.',
    slots,
    steps: [
      { id: 'sor', type: 'collect', slots: ['yontem'] },
      { id: 'bitti', type: 'resolve', outcome: 'resolved_waiting' },
    ],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.procedure;
}

const DEPOSIT = procedure([
  { name: 'yontem', label: 'Ödeme yöntemi', type: 'text', ask: 'Hangi yöntemle?' },
  { name: 'zaman', label: 'İşlem zamanı', type: 'datetime', ask: 'Ne zaman?' },
  { name: 'iban_son4', label: 'IBAN son 4', type: 'iban_last4', ask: 'IBAN son 4?', pii: 'high' },
]);

const snapshot = (name: string, definition: Procedure) => ({
  skill_name: name,
  ai_agent_id: null,
  locked: false,
  procedure: definition,
});

describe('conversationView (AI-03 §13)', () => {
  it('a connection the AI has not opened: nothing in progress, nothing collected', () => {
    expect(conversationView(emptyTurnState())).toEqual({
      mode: 'ai',
      procedure: null,
      slots: [],
      suspended: null,
      turns: 0,
      outcome: null,
    });
  });

  it('shows the pinned procedure, its step, and every slot it collects in its order', () => {
    const state: TurnState = {
      ...emptyTurnState(),
      activeSkillId: 'skill-1',
      procedureSnapshot: snapshot('Yatırım geçmedi', DEPOSIT),
      procedureSnapshotHash: procedureHash(DEPOSIT),
      stepId: 'sor',
      stepStatus: 'awaiting_answer',
      slots: {
        zaman: {
          value: null,
          display: '16.10.2026 akşam',
          status: 'partial',
          attempts: 1,
          turn: 1,
        },
        iban_son4: {
          value: '1234',
          display: '1234',
          status: 'filled',
          attempts: 1,
          turn: 1,
          pii: 'high',
        },
        // A slot the procedure does not define: listed after its own, by name.
        siparis: 'A-77',
      },
      counters: { turns: 2 },
    };
    const view = conversationView(state);
    expect(view.procedure).toEqual({
      skill_id: 'skill-1',
      skill_name: 'Yatırım geçmedi',
      snapshot_hash: procedureHash(DEPOSIT),
      step_id: 'sor',
      step_status: 'awaiting_answer',
    });
    expect(view.turns).toBe(2);
    expect(view.slots).toEqual([
      {
        name: 'yontem',
        label: 'Ödeme yöntemi',
        type: 'text',
        status: 'missing',
        display: null,
        source: 'player',
        attempts: 0,
        sensitive: false,
      },
      {
        name: 'zaman',
        label: 'İşlem zamanı',
        type: 'datetime',
        status: 'partial',
        display: '16.10.2026 akşam',
        source: 'player',
        attempts: 1,
        sensitive: false,
      },
      {
        name: 'iban_son4',
        label: 'IBAN son 4',
        type: 'iban_last4',
        status: 'filled',
        display: '1234',
        source: 'player',
        attempts: 1,
        sensitive: true,
      },
      {
        name: 'siparis',
        label: 'siparis',
        type: null,
        status: 'filled',
        display: 'A-77',
        source: 'player',
        attempts: 0,
        sensitive: false,
      },
    ]);
    // The raw value and its history are not part of the view.
    expect(JSON.stringify(view)).not.toContain('previous_values');
  });

  it('shows the topic set aside with its own step and slots, from its own snapshot', () => {
    const other = procedure([
      { name: 'yontem', label: 'Çekim yöntemi', type: 'text', ask: 'Hangi yöntemle?' },
    ]);
    const state: TurnState = {
      ...emptyTurnState(),
      suspended: {
        skill_id: 'skill-2',
        snapshot: snapshot('Çekim gecikti', other),
        snapshot_hash: procedureHash(other),
        step_id: 'sor',
        step_status: 'awaiting_answer',
        slots: { yontem: { value: 'Papara', display: 'Papara', status: 'filled', turn: 1 } },
        procedure_turns: 1,
        suspended_at: '2026-10-18T10:00:00.000Z',
        offered: false,
      },
    };
    expect(conversationView(state).suspended).toEqual({
      skill_id: 'skill-2',
      skill_name: 'Çekim gecikti',
      snapshot_hash: procedureHash(other),
      step_id: 'sor',
      step_status: 'awaiting_answer',
      slots: [
        {
          name: 'yontem',
          label: 'Çekim yöntemi',
          type: 'text',
          status: 'filled',
          display: 'Papara',
          source: 'player',
          attempts: 0,
          sensitive: false,
        },
      ],
    });
  });

  it('a snapshot that no longer reads keeps the step, without a name it cannot vouch for', () => {
    const view = conversationView({
      ...emptyTurnState(),
      activeSkillId: 'skill-1',
      procedureSnapshot: { skill_name: 'x', procedure: { steps: 'broken' } },
      stepId: 'sor',
      stepStatus: 'ready',
      mode: 'human',
      outcome: 'handed_off',
    });
    expect(view).toMatchObject({
      mode: 'human',
      outcome: 'handed_off',
      procedure: { skill_id: 'skill-1', skill_name: null, step_id: 'sor', step_status: 'ready' },
      slots: [],
    });
  });
});
