/**
 * The document vocabulary both ends share (tm 313.1 · AI-18). The text-file
 * allow-list (`knowledge-file.ts`) must not widen because documents arrived:
 * a PDF is never a text file, and a text file is never a document.
 */
import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_DOCUMENT_DOCX,
  KNOWLEDGE_DOCUMENT_ERRORS,
  KNOWLEDGE_DOCUMENT_LIMITS,
  KNOWLEDGE_DOCUMENT_MIME_TYPES,
  KNOWLEDGE_DOCUMENT_PDF,
  knowledgeDocumentMimeFor,
  normalizeKnowledgeDocumentMime,
} from './knowledge-document.js';
import { KNOWLEDGE_FILE_MIME_TYPES, normalizeKnowledgeFileMime } from './knowledge-file.js';

describe('knowledge documents (FR-MOD-06.3.2)', () => {
  it('takes PDF and DOCX only, whatever the casing or charset parameter', () => {
    expect(normalizeKnowledgeDocumentMime('application/PDF')).toBe(KNOWLEDGE_DOCUMENT_PDF);
    expect(normalizeKnowledgeDocumentMime(`${KNOWLEDGE_DOCUMENT_DOCX}; charset=binary`)).toBe(
      KNOWLEDGE_DOCUMENT_DOCX,
    );
    for (const refused of [
      'application/vnd.ms-word.document.macroEnabled.12',
      'application/msword',
      'application/zip',
      'application/x-msdownload',
      'text/plain',
      '',
      null,
      undefined,
    ]) {
      expect(normalizeKnowledgeDocumentMime(refused)).toBeNull();
    }
  });

  it('keeps the text-file path as it was: no type is both a text file and a document', () => {
    for (const mime of KNOWLEDGE_DOCUMENT_MIME_TYPES) {
      expect(normalizeKnowledgeFileMime(mime)).toBeNull();
    }
    for (const mime of KNOWLEDGE_FILE_MIME_TYPES) {
      expect(normalizeKnowledgeDocumentMime(mime)).toBeNull();
    }
  });

  it('guesses from the declared type first, then the extension; .docm is not a guess it makes', () => {
    expect(knowledgeDocumentMimeFor('Bonus Şartları.PDF', '')).toBe(KNOWLEDGE_DOCUMENT_PDF);
    expect(knowledgeDocumentMimeFor('kılavuz.docx')).toBe(KNOWLEDGE_DOCUMENT_DOCX);
    expect(knowledgeDocumentMimeFor('notes.txt', 'application/pdf')).toBe(KNOWLEDGE_DOCUMENT_PDF);
    expect(knowledgeDocumentMimeFor('macros.docm')).toBeNull();
    expect(knowledgeDocumentMimeFor('setup.exe')).toBeNull();
    expect(knowledgeDocumentMimeFor('.pdf')).toBeNull();
  });

  it('holds the AI-18-S1 ceilings and the seven codes the contract names', () => {
    expect(KNOWLEDGE_DOCUMENT_LIMITS).toEqual({
      maxBytes: 20_971_520,
      maxPages: 300,
      maxChars: 1_000_000,
    });
    for (const code of [
      'unsupported_type',
      'file_too_large',
      'encrypted',
      'no_text_layer',
      'too_many_pages',
      'parse_timeout',
      'virus_detected',
    ]) {
      expect(KNOWLEDGE_DOCUMENT_ERRORS).toContain(code);
    }
    for (const code of KNOWLEDGE_DOCUMENT_ERRORS) {
      // The shape `knowledge_jobs_error_check` accepts.
      expect(code).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    }
  });
});
