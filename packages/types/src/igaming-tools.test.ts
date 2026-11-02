import { describe, expect, it } from 'vitest';
import {
  IGAMING_TOOL_CATALOG,
  TOOL_HANDOFF_REASONS,
  igamingTool,
  toolOutputValueFits,
} from './igaming-tools.js';
import { PROCEDURE_KEY_PATTERN } from './procedure.js';
import { isHandoffReason } from './handoff.js';

describe('the iGaming tool catalogue (AI-28 F1)', () => {
  it('ships the seven read tools, all F2, none a write', () => {
    expect(IGAMING_TOOL_CATALOG.map((tool) => tool.key)).toEqual([
      'deposit_lookup',
      'withdrawal_status',
      'kyc_status',
      'bonus_status',
      'bet_lookup',
      'account_status',
      'limit_status',
    ]);
    for (const tool of IGAMING_TOOL_CATALOG) {
      expect(tool.kind).toBe('read');
      expect(tool.phase).toBe('f2');
      expect(tool.input_schema_version).toBe(1);
      expect(tool.timeout_ms).toBeGreaterThan(0);
      expect(tool.title_tr.length).toBeGreaterThan(0);
    }
  });

  it('keeps every schema self-consistent', () => {
    for (const tool of IGAMING_TOOL_CATALOG) {
      expect(tool.key).toMatch(PROCEDURE_KEY_PATTERN);
      for (const schema of [tool.input_schema, tool.output_schema]) {
        expect(schema.type).toBe('object');
        expect(schema.additionalProperties).toBe(false);
        for (const name of schema.required) expect(Object.keys(schema.properties)).toContain(name);
        for (const name of Object.keys(schema.properties))
          expect(name).toMatch(PROCEDURE_KEY_PATTERN);
      }
      // F2 takes the identity from the verified session: the inputs it replaces are named.
      expect(tool.requires_verified_identity).toBe(true);
      expect(tool.identity_inputs.length).toBeGreaterThan(0);
      for (const name of tool.identity_inputs) {
        expect(Object.keys(tool.input_schema.properties)).toContain(name);
      }
      // A branch needs a field to read: every tool returns a status with its values.
      expect(tool.output_schema.properties['status']?.enum?.length).toBeGreaterThan(1);
    }
  });

  it('finds a tool by key and nothing else', () => {
    expect(igamingTool('deposit_lookup')?.title_tr).toBe('yatırım sorgusu');
    expect(igamingTool('balance_lookup')).toBeUndefined();
    expect(igamingTool('toString')).toBeUndefined();
  });

  it('says which values an output field may hold', () => {
    const deposit = igamingTool('deposit_lookup')!;
    expect(toolOutputValueFits(deposit, 'status', 'credited')).toBe(true);
    expect(toolOutputValueFits(deposit, 'status', 'paid')).toBe(false);
    expect(toolOutputValueFits(deposit, 'status', 1)).toBe(false);
    expect(toolOutputValueFits(deposit, 'amount', 2500)).toBe(true);
    expect(toolOutputValueFits(deposit, 'amount', '2500')).toBe(false);
    expect(toolOutputValueFits(deposit, 'credited_at', '2026-11-02T13:42:00Z')).toBe(true);
    expect(toolOutputValueFits(deposit, 'balance', 1)).toBe(false);
    expect(toolOutputValueFits(deposit, 'constructor', 'x')).toBe(false);
  });

  it("gives hand-over reasons outside the catalogue, so they count as the procedure's rule", () => {
    for (const reason of TOOL_HANDOFF_REASONS) expect(isHandoffReason(reason)).toBe(false);
  });
});
