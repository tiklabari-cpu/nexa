/**
 * The pieces of a document source that are not a request (tm 313.1 · AI-18):
 * the name its original is saved under, and telling the same file added twice
 * at once from any other refused insert.
 */
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_DOCUMENT_DOCX, KNOWLEDGE_DOCUMENT_PDF } from '@siyahtus/types';
import { documentDownloadName, isDuplicateDocument } from './knowledge-document.js';

describe('documentDownloadName', () => {
  it("adds the type's extension unless the title already ends in it", () => {
    expect(documentDownloadName('Bonus Şartları', KNOWLEDGE_DOCUMENT_PDF)).toBe(
      'Bonus Şartları.pdf',
    );
    expect(documentDownloadName('Kılavuz.DOCX', KNOWLEDGE_DOCUMENT_DOCX)).toBe('Kılavuz.DOCX');
    expect(documentDownloadName('notes.pdf', KNOWLEDGE_DOCUMENT_DOCX)).toBe('notes.pdf.docx');
  });

  it('takes out directory separators and control characters, and never answers empty', () => {
    expect(documentDownloadName('../../etc/passwd', KNOWLEDGE_DOCUMENT_PDF)).toBe(
      '.. .. etc passwd.pdf',
    );
    expect(documentDownloadName('a\r\nb\\c', KNOWLEDGE_DOCUMENT_PDF)).toBe('a b c.pdf');
    expect(documentDownloadName(' / ', KNOWLEDGE_DOCUMENT_PDF)).toBe('document.pdf');
  });
});

describe('isDuplicateDocument', () => {
  const unique = (target: unknown) =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it("is the original's unique indexes, by field list or by index name", () => {
    expect(isDuplicateDocument(unique(['license_id', 'file_sha256']))).toBe(true);
    expect(isDuplicateDocument(unique('knowledge_sources_file_key_key'))).toBe(true);
  });

  it('is not another unique index, another error, or anything else', () => {
    expect(isDuplicateDocument(unique(['kb_article_id']))).toBe(false);
    expect(isDuplicateDocument(unique('knowledge_jobs_one_active_per_source'))).toBe(false);
    expect(isDuplicateDocument(new Error('file_sha256'))).toBe(false);
    expect(isDuplicateDocument(null)).toBe(false);
  });
});
