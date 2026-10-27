/**
 * The type of a knowledge document, read from its bytes (tm 313.1 · AI-18).
 *
 * Each refusal here is a file someone could upload under a `.pdf` or `.docx`
 * name; each acceptance is one the worker will be asked to read. The cases
 * that matter most are the near misses — an executable carrying a PDF header
 * a little way in, a Word document with a macro project, a ZIP whose end
 * record is a decoy inside its own comment.
 */
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_DOCUMENT_DOCX, KNOWLEDGE_DOCUMENT_PDF } from '@siyahtus/types';
import { identifyKnowledgeDocument } from './knowledge-document-type.js';
import { EXE, docm, docx, docxEntries, pdf, zip } from '../../../test/helpers/document-fixtures.js';
import { EICAR_SIGNATURE } from '../storage/virus-scanner.js';

describe('identifyKnowledgeDocument (FR-MOD-06.3.2)', () => {
  it('knows a PDF by its header at offset 0', () => {
    expect(identifyKnowledgeDocument(pdf(['Bonus şartları']))).toEqual({
      ok: true,
      mime: KNOWLEDGE_DOCUMENT_PDF,
    });
    expect(identifyKnowledgeDocument(Buffer.from('%PDF-2.0\n'))).toEqual({
      ok: true,
      mime: KNOWLEDGE_DOCUMENT_PDF,
    });
  });

  it('refuses a PDF header anywhere but the first byte, and a header without a version', () => {
    const withHeaderInside = Buffer.concat([EXE, pdf(['hidden'])]);
    expect(identifyKnowledgeDocument(withHeaderInside)).toEqual({
      ok: false,
      why: 'not_pdf_or_zip',
    });
    expect(identifyKnowledgeDocument(Buffer.from(' %PDF-1.7 leading space'))).toMatchObject({
      ok: false,
    });
    expect(identifyKnowledgeDocument(Buffer.from('%PDF-x.y no version'))).toMatchObject({
      ok: false,
    });
  });

  it('refuses a renamed executable, plain text, an EICAR file and an empty file', () => {
    for (const bytes of [
      EXE,
      Buffer.from('just some text, renamed to .pdf'),
      Buffer.from(EICAR_SIGNATURE, 'latin1'),
      Buffer.alloc(0),
      Buffer.from('PK'),
    ]) {
      expect(identifyKnowledgeDocument(bytes)).toEqual({ ok: false, why: 'not_pdf_or_zip' });
    }
  });

  it('knows a DOCX by the parts its central directory lists', () => {
    expect(identifyKnowledgeDocument(docx(['Para çekme süreleri']))).toEqual({
      ok: true,
      mime: KNOWLEDGE_DOCUMENT_DOCX,
    });
    // OPC part names compare case-insensitively.
    const shouting = zip(
      docxEntries([]).map((entry) =>
        entry.name === 'word/document.xml' ? { ...entry, name: 'WORD/Document.XML' } : entry,
      ),
    );
    expect(identifyKnowledgeDocument(shouting)).toMatchObject({ ok: true });
  });

  it('refuses a Word document with a macro project — a .docm, whatever it is named', () => {
    expect(identifyKnowledgeDocument(docm(['Etkinleştir']))).toEqual({
      ok: false,
      why: 'macro_enabled',
    });
    const nested = zip(docxEntries([], [{ name: 'word/sub/VBAPROJECT.BIN', data: 'x' }]));
    expect(identifyKnowledgeDocument(nested)).toEqual({ ok: false, why: 'macro_enabled' });
  });

  it('refuses a ZIP that is not a Word document', () => {
    const spreadsheet = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook/>' },
    ]);
    expect(identifyKnowledgeDocument(spreadsheet)).toEqual({ ok: false, why: 'not_word' });
    const noContentTypes = zip([{ name: 'word/document.xml', data: '<w:document/>' }]);
    expect(identifyKnowledgeDocument(noContentTypes)).toEqual({ ok: false, why: 'not_word' });
  });

  it('refuses an archive naming one part twice — two readers, two documents', () => {
    const twice = zip([...docxEntries(['a']), { name: 'Word/document.xml', data: '<other/>' }]);
    expect(identifyKnowledgeDocument(twice)).toEqual({ ok: false, why: 'zip_unreadable' });
  });

  it('refuses a truncated archive, bytes after its end record and a directory that lies', () => {
    const good = docx(['x']);
    expect(identifyKnowledgeDocument(good.subarray(0, good.length - 10))).toEqual({
      ok: false,
      why: 'zip_unreadable',
    });
    expect(identifyKnowledgeDocument(Buffer.concat([good, Buffer.from('trailing')]))).toEqual({
      ok: false,
      why: 'zip_unreadable',
    });

    // A central directory that claims to run past its own end record.
    const lying = Buffer.from(good);
    const eocd = lying.length - 22;
    lying.writeUInt32LE(lying.readUInt32LE(eocd + 12) + 1000, eocd + 12);
    expect(identifyKnowledgeDocument(lying)).toEqual({ ok: false, why: 'zip_unreadable' });

    // An entry whose name length points past the directory.
    const longName = Buffer.from(good);
    const directory = longName.readUInt32LE(eocd + 16);
    longName.writeUInt16LE(0xffff, directory + 28);
    expect(identifyKnowledgeDocument(longName)).toEqual({ ok: false, why: 'zip_unreadable' });
  });

  it('refuses multi-disk and ZIP64 archives', () => {
    const good = docx(['x']);
    const eocd = good.length - 22;
    const multiDisk = Buffer.from(good);
    multiDisk.writeUInt16LE(1, eocd + 4);
    expect(identifyKnowledgeDocument(multiDisk)).toEqual({ ok: false, why: 'zip_unsupported' });
    const zip64 = Buffer.from(good);
    zip64.writeUInt32LE(0xffffffff, eocd + 16);
    expect(identifyKnowledgeDocument(zip64)).toEqual({ ok: false, why: 'zip_unsupported' });
  });
});
