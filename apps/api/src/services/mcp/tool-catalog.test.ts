import { describe, expect, it } from 'vitest';
import { isScope } from '@nexa/types';
import { MCP_TOOL_CATALOG, toolByName } from './tool-catalog.js';

// KK (birebir): "search_tickets/list_chats/get_report/summarize_chat tool'ları"
const KK_TOOL_NAMES = ['search_tickets', 'list_chats', 'get_report', 'summarize_chat'];

describe('MCP_TOOL_CATALOG', () => {
  it('contains exactly the four KK tools, no more, no fewer', () => {
    expect(MCP_TOOL_CATALOG.map((tool) => tool.name).sort()).toEqual([...KK_TOOL_NAMES].sort());
  });

  it('gives every tool a title and a description', () => {
    for (const tool of MCP_TOOL_CATALOG) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('gates every tool behind at least one real, currently-defined scope', () => {
    for (const tool of MCP_TOOL_CATALOG) {
      expect(tool.requiredScopes.length).toBeGreaterThan(0);
      for (const scope of tool.requiredScopes) {
        expect(isScope(scope)).toBe(true);
      }
    }
  });

  it('copies requiredScopes verbatim from the routes each tool stands in for', () => {
    expect(toolByName('search_tickets')?.requiredScopes).toEqual([
      'tickets--all:ro',
      'tickets--access:ro',
    ]);
    expect(toolByName('list_chats')?.requiredScopes).toEqual(['chats--all:ro', 'chats--access:ro']);
    expect(toolByName('get_report')?.requiredScopes).toEqual(['reports_read']);
    expect(toolByName('summarize_chat')?.requiredScopes).toEqual([
      'chats--all:ro',
      'chats--access:ro',
    ]);
  });
});

describe('toolByName', () => {
  it('resolves each KK tool name to its catalog entry', () => {
    for (const name of KK_TOOL_NAMES) {
      expect(toolByName(name)?.name).toBe(name);
    }
  });

  it('returns undefined for a name that names no tool', () => {
    expect(toolByName('nope')).toBeUndefined();
  });

  it('is case-sensitive — no fuzzy match on a near-miss name', () => {
    expect(toolByName('Search_Tickets')).toBeUndefined();
    expect(toolByName('search_ticket')).toBeUndefined();
  });
});

describe('search_tickets inputSchema', () => {
  const schema = toolByName('search_tickets')!.inputSchema;

  it('accepts a bare query, defaulting view and limit', () => {
    const parsed = schema.parse({ query: 'refund' });
    expect(parsed).toMatchObject({ query: 'refund', view: 'all', limit: 25 });
  });

  it('rejects an empty object — query is required', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank query', () => {
    expect(schema.safeParse({ query: '   ' }).success).toBe(false);
  });

  it('rejects an unknown view value', () => {
    expect(schema.safeParse({ query: 'refund', view: 'bogus' }).success).toBe(false);
  });

  it('rejects a limit outside 1..100', () => {
    expect(schema.safeParse({ query: 'refund', limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ query: 'refund', limit: 101 }).success).toBe(false);
  });
});

describe('list_chats inputSchema', () => {
  const schema = toolByName('list_chats')!.inputSchema;

  it('accepts an empty object — every filter is optional', () => {
    const parsed = schema.parse({});
    expect(parsed).toMatchObject({ view: 'all', limit: 25 });
  });

  it('rejects an unknown view value', () => {
    expect(schema.safeParse({ view: 'bogus' }).success).toBe(false);
  });

  it('rejects a non-numeric limit', () => {
    expect(schema.safeParse({ limit: 'lots' }).success).toBe(false);
  });
});

describe('get_report inputSchema', () => {
  const schema = toolByName('get_report')!.inputSchema;

  it('accepts a bare report name', () => {
    expect(schema.safeParse({ report: 'overview' }).success).toBe(true);
  });

  it('accepts every KK report enum value', () => {
    for (const report of ['overview', 'breakdown', 'ai-agent', 'reviews']) {
      expect(schema.safeParse({ report }).success).toBe(true);
    }
  });

  it('rejects an empty object — report is required', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown report name', () => {
    expect(schema.safeParse({ report: 'topics' }).success).toBe(false);
  });

  it('rejects a malformed date range', () => {
    expect(schema.safeParse({ report: 'overview', from: 'not-a-date' }).success).toBe(false);
  });
});

describe('summarize_chat inputSchema', () => {
  const schema = toolByName('summarize_chat')!.inputSchema;

  it('accepts a chat id', () => {
    expect(schema.safeParse({ chat_id: 'S1234567890' }).success).toBe(true);
  });

  it('rejects an empty object — chat_id is required', () => {
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects a blank chat_id', () => {
    expect(schema.safeParse({ chat_id: '   ' }).success).toBe(false);
  });

  it('rejects a chat_id past the 12-character id length', () => {
    expect(schema.safeParse({ chat_id: 'x'.repeat(13) }).success).toBe(false);
  });
});

describe('inputJsonSchema', () => {
  it('marks the same fields required as the zod schema does', () => {
    expect(toolByName('search_tickets')!.inputJsonSchema.required).toEqual(['query']);
    expect(toolByName('list_chats')!.inputJsonSchema.required).toEqual([]);
    expect(toolByName('get_report')!.inputJsonSchema.required).toEqual(['report']);
    expect(toolByName('summarize_chat')!.inputJsonSchema.required).toEqual(['chat_id']);
  });

  it('is a plain object schema for every tool', () => {
    for (const tool of MCP_TOOL_CATALOG) {
      expect(tool.inputJsonSchema.type).toBe('object');
      expect(tool.inputJsonSchema.additionalProperties).toBe(false);
    }
  });
});
