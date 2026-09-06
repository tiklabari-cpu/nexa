/**
 * The upload allow-list both ends share (FR-MOD-06.3.2).
 *
 * What is worth pinning here is the *asymmetry* the module is built on: a
 * declared media type can only ever narrow to one of three values, while the
 * extension map is a guess a client is allowed to make and the server is not.
 * Getting either backwards is how "unsupported type rejected" stops being true.
 */
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_FILE_MAX_BYTES,
  KNOWLEDGE_FILE_MAX_CHARS,
  KNOWLEDGE_FILE_MIME_TYPES,
  knowledgeFileExtension,
  knowledgeFileMimeFor,
  normalizeKnowledgeFileMime,
} from './knowledge-file.js';

describe('knowledge file upload limits (FR-MOD-06.3.2)', () => {
  it('accepts only the three text types, whatever the casing or charset parameter', () => {
    expect(normalizeKnowledgeFileMime('text/plain')).toBe('text/plain');
    expect(normalizeKnowledgeFileMime('TEXT/Markdown')).toBe('text/markdown');
    expect(normalizeKnowledgeFileMime('text/csv; charset=utf-8')).toBe('text/csv');
    expect(normalizeKnowledgeFileMime('  text/plain  ')).toBe('text/plain');
  });

  it('refuses every type outside the allow-list, including the blank one a browser reports', () => {
    for (const rejected of [
      'application/pdf',
      'application/octet-stream',
      'text/html',
      'image/png',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(normalizeKnowledgeFileMime(rejected)).toBeNull();
    }
  });

  it('reads an extension without letting a path or a leading dot become one', () => {
    expect(knowledgeFileExtension('policy.MD')).toBe('.md');
    expect(knowledgeFileExtension('notes.tar.gz')).toBe('.gz');
    expect(knowledgeFileExtension('README')).toBe('');
    // A dotfile has no extension — `.env` is a name, not a `.env`-typed file.
    expect(knowledgeFileExtension('.env')).toBe('');
    // Directory separators are stripped before the dot is looked for, so a
    // path cannot hide the real extension behind an earlier segment.
    expect(knowledgeFileExtension('../../etc/passwd.txt')).toBe('.txt');
    expect(knowledgeFileExtension('C:\\docs\\policy.csv')).toBe('.csv');
  });

  it('prefers what the browser declared over what the name implies', () => {
    expect(knowledgeFileMimeFor('export.txt', 'text/csv')).toBe('text/csv');
    expect(knowledgeFileMimeFor('handbook.md', '')).toBe('text/markdown');
    expect(knowledgeFileMimeFor('handbook.md', 'application/octet-stream')).toBe('text/markdown');
    expect(knowledgeFileMimeFor('report.pdf', 'application/pdf')).toBeNull();
    expect(knowledgeFileMimeFor('archive.zip')).toBeNull();
  });

  it('keeps the character ceiling equal to the pasted-content ceiling', () => {
    // `createSourceBody`'s `content` cap. If these ever diverge, an upload
    // could carry text the paste path would have refused.
    expect(KNOWLEDGE_FILE_MAX_CHARS).toBe(100_000);
    expect(KNOWLEDGE_FILE_MAX_BYTES).toBeGreaterThan(KNOWLEDGE_FILE_MAX_CHARS);
    expect(KNOWLEDGE_FILE_MIME_TYPES).toHaveLength(3);
  });
});
