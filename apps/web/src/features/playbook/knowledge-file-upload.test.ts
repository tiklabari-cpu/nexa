/**
 * The knowledge upload's client-side prechecks (FR-MOD-06.3.2).
 *
 * These refusals are UX, not security — the endpoint re-checks all of them and
 * one thing none of these can: whether the bytes are text. What is worth
 * pinning is that the precheck never *narrows* past the server, because a
 * client that refuses a file the API would have accepted is a bug nobody can
 * work around, while a client that lets one through only costs a slower error.
 */
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_FILE_MAX_BYTES } from '@nexa/types';
import {
  KNOWLEDGE_FILE_ACCEPT,
  precheckKnowledgeFile,
  readKnowledgeFile,
} from './knowledge-file-upload.js';

const file = (body: string, name: string, type: string): File => new File([body], name, { type });

describe('precheckKnowledgeFile (FR-MOD-06.3.2)', () => {
  it('accepts the three supported kinds', () => {
    expect(precheckKnowledgeFile(file('hello', 'notes.txt', 'text/plain')).ok).toBe(true);
    expect(precheckKnowledgeFile(file('# hi', 'handbook.md', 'text/markdown')).ok).toBe(true);
    expect(precheckKnowledgeFile(file('a,b', 'prices.csv', 'text/csv')).ok).toBe(true);
  });

  /**
   * Most browsers report nothing for a `.md` file and some report
   * `application/octet-stream`. Refusing either would make Markdown
   * unuploadable on those platforms — which is why the name is consulted when
   * the declared type is not one we know.
   */
  it('falls back to the extension when the browser cannot name the type', () => {
    expect(precheckKnowledgeFile(file('# hi', 'handbook.md', '')).ok).toBe(true);
    expect(
      precheckKnowledgeFile(file('# hi', 'handbook.markdown', 'application/octet-stream')).ok,
    ).toBe(true);
  });

  it('refuses a kind the endpoint would refuse, naming what to pick instead', () => {
    const rejection = precheckKnowledgeFile(file('%PDF', 'manual.pdf', 'application/pdf'));
    expect(rejection).toMatchObject({ ok: false, reason: 'invalid_type' });
    expect(rejection.ok === false && rejection.message).toMatch(/\.txt, \.md or \.csv/);
  });

  it('refuses an empty file and one over the byte ceiling', () => {
    expect(precheckKnowledgeFile({ name: 'a.txt', type: 'text/plain', size: 0 })).toMatchObject({
      reason: 'empty_file',
    });
    expect(
      precheckKnowledgeFile({
        name: 'a.txt',
        type: 'text/plain',
        size: KNOWLEDGE_FILE_MAX_BYTES + 1,
      }),
    ).toMatchObject({ reason: 'too_large' });
    // Exactly at the ceiling is allowed — the server's check is `>`, not `>=`,
    // and a client that refused here would be stricter than the API.
    expect(
      precheckKnowledgeFile({ name: 'a.txt', type: 'text/plain', size: KNOWLEDGE_FILE_MAX_BYTES })
        .ok,
    ).toBe(true);
  });

  it('offers both extensions and media types to the file picker', () => {
    for (const token of ['.txt', '.md', '.markdown', '.csv', 'text/plain', 'text/csv']) {
      expect(KNOWLEDGE_FILE_ACCEPT.split(',')).toContain(token);
    }
  });
});

describe('readKnowledgeFile (FR-MOD-06.3.2)', () => {
  it('returns base64 bytes the server can decode back to the file', async () => {
    const body = 'Returns are accepted within 30 days.';
    const result = await readKnowledgeFile(file(body, 'returns.txt', 'text/plain'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe('returns.txt');
    expect(result.contentType).toBe('text/plain');
    // The round trip is the assertion: what is sent is what was picked, not a
    // browser-decoded rendering of it.
    expect(Buffer.from(result.data, 'base64').toString('utf8')).toBe(body);
  });

  it('sends the type the extension implies when the browser named none', async () => {
    const result = await readKnowledgeFile(file('# Warranty', 'warranty.md', ''));
    expect(result.ok && result.contentType).toBe('text/markdown');
  });

  it('refuses without reading when the precheck already said no', async () => {
    const result = await readKnowledgeFile(file('%PDF', 'manual.pdf', 'application/pdf'));
    expect(result).toMatchObject({ ok: false, reason: 'invalid_type' });
  });
});
