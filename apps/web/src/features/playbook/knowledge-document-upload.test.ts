/**
 * The Files tab's document helpers (tm 313.3 · AI-18): which files are
 * documents, the size precheck, and the sentence a refusal code maps to.
 */
import { KNOWLEDGE_DOCUMENT_ERRORS } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import {
  KNOWLEDGE_DOCUMENT_ERROR_KEYS,
  documentRequestErrorKey,
  isKnowledgeDocument,
  knowledgeDocumentErrorCode,
  precheckKnowledgeDocument,
  withDocumentAccept,
} from './knowledge-document-upload.js';

describe('knowledge document helpers (FR-MOD-06.3.2)', () => {
  it('recognises a PDF and a Word document by type or extension, and nothing else', () => {
    expect(isKnowledgeDocument({ name: 'a.pdf', type: '' })).toBe(true);
    expect(isKnowledgeDocument({ name: 'A.DOCX', type: '' })).toBe(true);
    expect(isKnowledgeDocument({ name: 'x', type: 'application/pdf' })).toBe(true);
    expect(isKnowledgeDocument({ name: 'a.txt', type: 'text/plain' })).toBe(false);
    expect(isKnowledgeDocument({ name: 'a.docm', type: '' })).toBe(false);
  });

  it('adds both documents to the picker’s accept list, extension and type', () => {
    const accept = withDocumentAccept('.txt');
    expect(accept.split(',')).toEqual(
      expect.arrayContaining(['.txt', '.pdf', '.docx', 'application/pdf']),
    );
  });

  it('refuses an empty file and one over 20 MiB, without a read', () => {
    expect(precheckKnowledgeDocument({ size: 0 })).toBe('empty_file');
    expect(precheckKnowledgeDocument({ size: 20 * 1024 * 1024 + 1 })).toBe('too_large');
    expect(precheckKnowledgeDocument({ size: 20 * 1024 * 1024 })).toBeNull();
  });

  it('has a sentence key for every refusal code the server has', () => {
    for (const code of KNOWLEDGE_DOCUMENT_ERRORS) {
      expect(KNOWLEDGE_DOCUMENT_ERROR_KEYS[code]).toBe(`playbook.knowledge.document.error.${code}`);
      expect(knowledgeDocumentErrorCode(code)).toBe(code);
    }
    // A free-text refresh failure is not a document code.
    expect(knowledgeDocumentErrorCode('Not refreshed: the AI allowance is used up.')).toBeNull();
    expect(knowledgeDocumentErrorCode(null)).toBeNull();
  });

  it('reads a request refusal’s reason, and leaves other errors to the generic sentence', () => {
    const refused = (details?: Record<string, unknown>) =>
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'no',
        requestId: 'r',
        ...(details ? { details } : {}),
      });
    expect(documentRequestErrorKey(refused({ reason: 'unsupported_type' }))).toBe(
      'playbook.knowledge.document.error.unsupported_type',
    );
    expect(documentRequestErrorKey(refused({ reason: 'unknown_upload' }))).toBeNull();
    expect(documentRequestErrorKey(refused())).toBeNull();
    expect(documentRequestErrorKey(new Error('x'))).toBeNull();
  });
});
