/**
 * The instruction compiler.
 *
 * Its most important behaviour is what it does with a line it does not
 * understand: report it. An LLM asked to compile something vague produces
 * something plausible, and a skill that plausibly does the wrong thing to a
 * customer is worse than one that refuses to compile.
 */
import { describe, expect, it } from 'vitest';
import { compileInstruction } from './compiler.js';
import { validateSteps } from './steps.js';

describe('compileInstruction', () => {
  it('compiles a realistic multi-step instruction', () => {
    const { steps, unrecognised } = compileInstruction(
      `When someone asks about delivery times, ask for their order number.
       Tag it as shipping.
       Answer from the knowledge base.
       If it is late, transfer to the Support team.`,
    );

    expect(unrecognised).toEqual([]);
    expect(steps.map((s) => s.type)).toEqual([
      'detect_intent',
      'request_info',
      'tag',
      'send_message',
      'transfer_to_team',
    ]);
  });

  it('always emits steps the engine will accept', () => {
    // The compiler is the only producer of steps that never goes through the
    // API's validation, so it has to hold the same contract itself.
    const { steps } = compileInstruction(
      'When a customer asks about refunds, reply with "We refund within 14 days." Then tag it as refund.',
    );
    expect(validateSteps(steps).ok).toBe(true);
  });

  it('takes the intent phrase from the trigger sentence', () => {
    const { steps } = compileInstruction('When someone asks about delivery times, summarise it.');
    const [first] = steps;

    expect(first).toMatchObject({ type: 'detect_intent', intent: 'delivery_times' });
  });

  it('distinguishes a fixed reply from a knowledge-base answer', () => {
    const fixed = compileInstruction('Reply with "We are closed on Sundays."').steps[0];
    expect(fixed).toEqual({
      type: 'send_message',
      source: 'text',
      text: 'We are closed on Sundays.',
    });

    const retrieved = compileInstruction('Answer from the knowledge base.').steps[0];
    expect(retrieved).toEqual({ type: 'send_message', source: 'knowledge' });
  });

  it('reads a transfer target without swallowing the word "team"', () => {
    expect(compileInstruction('Transfer to the Billing team.').steps[0]).toEqual({
      type: 'transfer_to_team',
      group: 'Billing',
    });
    expect(compileInstruction('Escalate to Support.').steps[0]).toEqual({
      type: 'transfer_to_team',
      group: 'Support',
    });
  });

  it('accepts list formatting, because that is how people write these', () => {
    const { steps, unrecognised } = compileInstruction(
      ['1. Ask for the order number', '2. Tag it as shipping', '- Summarise it'].join('\n'),
    );
    expect(unrecognised).toEqual([]);
    expect(steps.map((s) => s.type)).toEqual(['request_info', 'tag', 'summarize']);
  });

  it('splits on "then"', () => {
    const { steps } = compileInstruction('Tag it as vip then summarise it');
    expect(steps.map((s) => s.type)).toEqual(['tag', 'summarize']);
  });

  it('reports lines it could not understand instead of inventing a step', () => {
    const { steps, unrecognised } = compileInstruction(
      'Tag it as vip. Do something clever about the situation. Summarise it.',
    );

    expect(steps.map((s) => s.type)).toEqual(['tag', 'summarize']);
    expect(unrecognised).toEqual(['Do something clever about the situation.']);
  });

  it('returns nothing at all for an empty instruction', () => {
    expect(compileInstruction('')).toEqual({ steps: [], unrecognised: [] });
    expect(compileInstruction('   \n  ')).toEqual({ steps: [], unrecognised: [] });
  });

  it('collapses a repeated neighbouring step', () => {
    // Otherwise the customer sees the same work done twice.
    const { steps } = compileInstruction('Summarise it. Summarise it.');
    expect(steps).toHaveLength(1);
  });

  it('is deterministic', () => {
    const instruction = 'When someone asks about refunds, tag it as refund and summarise it.';
    expect(compileInstruction(instruction)).toEqual(compileInstruction(instruction));
  });
});
