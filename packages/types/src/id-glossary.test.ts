import { describe, expect, it } from 'vitest';
import {
  classifyIdentifier,
  ID_GLOSSARY,
  ID_KINDS,
  idExportHeader,
  idKindInfo,
} from './id-glossary.js';
import {
  buildEventId,
  EVENT_ID_RE,
  generateShortId,
  isEventId,
  isShortId,
  isUuid,
  SHORT_ID_RE,
  UUID_RE,
} from './ids.js';

const UUID = '3f2b8c1e-5d4a-4e7b-9c1d-2a6f8e0b4c7d';

describe('ID glossary catalogue (ID-01)', () => {
  it('has one entry per kind, keyed by its own kind', () => {
    expect(Object.keys(ID_GLOSSARY).sort()).toEqual([...ID_KINDS].sort());
    for (const kind of ID_KINDS) expect(idKindInfo(kind).kind).toBe(kind);
  });

  it('maps the panel names the owner uses onto the code fields, opposite to the code words (K1 = A)', () => {
    expect(ID_GLOSSARY.day_thread).toMatchObject({ screenName: 'Thread ID', codeField: 'chat_id' });
    expect(ID_GLOSSARY.connection).toMatchObject({ screenName: 'Chat ID', codeField: 'thread_id' });
  });

  it('gives every kind a distinct screen name and a distinct code field', () => {
    const infos = ID_KINDS.map((kind) => ID_GLOSSARY[kind]);
    expect(new Set(infos.map((i) => i.screenName)).size).toBe(infos.length);
    expect(new Set(infos.map((i) => i.codeField)).size).toBe(infos.length);
  });

  it('names catalogue keys under ids.<name>.label / .hint, one pair per kind', () => {
    for (const kind of ID_KINDS) {
      const { labelKey, shortDescriptionKey } = ID_GLOSSARY[kind];
      expect(labelKey).toMatch(/^ids\.[A-Za-z]+\.label$/);
      expect(shortDescriptionKey).toBe(labelKey.replace(/\.label$/, '.hint'));
    }
    const labels = ID_KINDS.map((kind) => ID_GLOSSARY[kind].labelKey);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('builds the export header with both names', () => {
    expect(idExportHeader('day_thread')).toBe('Thread ID (chat_id)');
    expect(idExportHeader('connection')).toBe('Chat ID (thread_id)');
  });
});

describe('ID glossary patterns agree with ids.ts', () => {
  it('reuses the exact short, event and UUID expressions, so they cannot drift', () => {
    expect(ID_GLOSSARY.day_thread.pattern).toBe(SHORT_ID_RE);
    expect(ID_GLOSSARY.connection.pattern).toBe(SHORT_ID_RE);
    expect(ID_GLOSSARY.ticket.pattern).toBe(SHORT_ID_RE);
    expect(ID_GLOSSARY.event.pattern).toBe(EVENT_ID_RE);
    for (const kind of ['customer', 'request', 'ai_decision'] as const) {
      expect(ID_GLOSSARY[kind].pattern).toBe(UUID_RE);
    }
  });

  it('accepts every generated token and event id and no other shape', () => {
    for (let i = 0; i < 100; i++) {
      const short = generateShortId();
      expect(ID_GLOSSARY.day_thread.pattern.test(short)).toBe(isShortId(short));
      expect(ID_GLOSSARY.event.pattern.test(buildEventId(short, i + 1))).toBe(true);
      expect(ID_GLOSSARY.event.pattern.test(short)).toBe(false);
    }
    expect(ID_GLOSSARY.customer.pattern.test(UUID)).toBe(isUuid(UUID));
  });
});

describe('classifyIdentifier (ID-06)', () => {
  it('returns every kind a ten-character token can be: day thread, connection, ticket', () => {
    expect(classifyIdentifier('TJ1H8CFKRV')).toEqual(['day_thread', 'connection', 'ticket']);
  });

  it('recognises a message id by the underscore and sequence, and only as a message id', () => {
    const id = buildEventId('TJ1H8CFKRV', 7);
    expect(isEventId(id)).toBe(true);
    expect(classifyIdentifier(id)).toEqual(['event']);
  });

  it('returns every kind a UUID can be: member, request, AI decision', () => {
    expect(classifyIdentifier(UUID)).toEqual(['customer', 'request', 'ai_decision']);
  });

  it('drops the whitespace a paste drags along but does not fold case', () => {
    expect(classifyIdentifier('  TJ1H8CFKRV\n')).toEqual(['day_thread', 'connection', 'ticket']);
    expect(classifyIdentifier('tj1h8cfkrv')).toEqual([]);
  });

  it('returns nothing for a name, an e-mail, an empty string or a malformed token', () => {
    for (const value of ['', '   ', 'Priya Nair', 'priya@acme.test', 'TJ1H8CFKR', 'TJ1H8CFKRI']) {
      expect(classifyIdentifier(value), value).toEqual([]);
    }
  });
});
