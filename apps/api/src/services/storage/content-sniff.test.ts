/**
 * An attachment's bytes against the type its grant was for (tm 446 · audit
 * F42). Each refusal is a file someone could send under an allowed type; each
 * acceptance is a real file of that type, so the near misses are the cases —
 * a program declared as a PDF, a macro document declared as Word, a CSV that
 * happens to start with the letters of an executable's signature.
 */
import { describe, expect, it } from 'vitest';
import { checkDeclaredType } from './content-sniff.js';
import { EXE, docm, docx, pdf, zip } from '../../../test/helpers/document-fixtures.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from('24000000', 'hex'),
  Buffer.from('WEBPVP8 ', 'latin1'),
]);
const ELF = Buffer.from('7f454c4602010100000000000000000002003e00', 'hex');
const MACH_O = Buffer.from('cffaedfe0c00000100000000020000001000000000', 'hex');
const OLE = Buffer.from('d0cf11e0a1b11ae1000000000000000000000000', 'hex');
const MP4 = Buffer.concat([
  Buffer.from('00000018', 'hex'),
  Buffer.from('ftypmp42isommp42', 'latin1'),
]);
const spreadsheet = zip([
  { name: '[Content_Types].xml', data: '<Types/>' },
  { name: 'xl/workbook.xml', data: '<workbook/>' },
]);

const ok = { ok: true };
const refused = (why: string) => ({ ok: false, why });

describe('checkDeclaredType — a type with a signature must open with it', () => {
  it('takes each image type with its own header, and not another image’s', () => {
    expect(checkDeclaredType(PNG, 'image/png')).toEqual(ok);
    expect(checkDeclaredType(JPEG, 'image/jpeg')).toEqual(ok);
    expect(checkDeclaredType(GIF, 'image/gif')).toEqual(ok);
    expect(checkDeclaredType(WEBP, 'image/webp')).toEqual(ok);
    // A JPEG renamed `.png` is refused rather than stored under the wrong type.
    expect(checkDeclaredType(JPEG, 'image/png')).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(PNG, 'image/gif')).toEqual(refused('signature_mismatch'));
  });

  it('refuses a program declared as a PDF — the audit’s case — and a PDF header a little way in', () => {
    expect(checkDeclaredType(pdf(['Terms']), 'application/pdf')).toEqual(ok);
    expect(checkDeclaredType(EXE, 'application/pdf')).toEqual(refused('signature_mismatch'));
    const late = Buffer.concat([Buffer.from('MZ\x90\x00'), pdf(['Terms'])]);
    expect(checkDeclaredType(late, 'application/pdf')).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(EXE, 'image/png')).toEqual(refused('signature_mismatch'));
  });

  it('reads the Office formats with the knowledge base’s reader: main part, no macros', () => {
    expect(checkDeclaredType(docx(['Para çekme']), DOCX)).toEqual(ok);
    expect(checkDeclaredType(spreadsheet, XLSX)).toEqual(ok);
    // A `.docm` under a Word type, a spreadsheet under it, and the other way round.
    expect(checkDeclaredType(docm(['Etkinleştir']), DOCX)).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(spreadsheet, DOCX)).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(docx(['a']), XLSX)).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(EXE, DOCX)).toEqual(refused('signature_mismatch'));
    // The legacy binary formats share one container signature.
    expect(checkDeclaredType(OLE, 'application/msword')).toEqual(ok);
    expect(checkDeclaredType(EXE, 'application/vnd.ms-excel')).toEqual(
      refused('signature_mismatch'),
    );
  });

  it('knows archives and media by their own openings', () => {
    expect(checkDeclaredType(spreadsheet, 'application/zip')).toEqual(ok);
    expect(checkDeclaredType(MP4, 'video/mp4')).toEqual(ok);
    expect(checkDeclaredType(EXE, 'application/zip')).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(PNG, 'video/mp4')).toEqual(refused('signature_mismatch'));
  });

  it('gives an admin who allows a program’s own type programs, and only those', () => {
    expect(checkDeclaredType(EXE, 'application/x-msdownload')).toEqual(ok);
    expect(checkDeclaredType(PNG, 'application/x-msdownload')).toEqual(
      refused('signature_mismatch'),
    );
  });

  it('compares the declared type without regard to case', () => {
    expect(checkDeclaredType(PNG, 'IMAGE/PNG')).toEqual(ok);
    expect(checkDeclaredType(EXE, 'Application/PDF')).toEqual(refused('signature_mismatch'));
  });

  it('refuses an empty or truncated file under a signed type', () => {
    expect(checkDeclaredType(Buffer.alloc(0), 'image/png')).toEqual(refused('signature_mismatch'));
    expect(checkDeclaredType(PNG.subarray(0, 4), 'image/png')).toEqual(
      refused('signature_mismatch'),
    );
  });
});

describe('checkDeclaredType — a text type must be text', () => {
  it('takes UTF-8, a legacy single-byte encoding and UTF-16 with its byte-order mark', () => {
    expect(checkDeclaredType(Buffer.from('ad;şehir\nAyşe;İzmir\n', 'utf8'), 'text/csv')).toEqual(
      ok,
    );
    // Windows-1254 "Ayşe": not valid UTF-8, and a file people really export.
    expect(checkDeclaredType(Buffer.from('4179fe65', 'hex'), 'text/csv')).toEqual(ok);
    const utf16 = Buffer.concat([Buffer.from('fffe', 'hex'), Buffer.from('merhaba', 'utf16le')]);
    expect(checkDeclaredType(utf16, 'text/plain')).toEqual(ok);
    expect(checkDeclaredType(Buffer.from('{"a":1}'), 'application/json')).toEqual(ok);
    expect(
      checkDeclaredType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/svg+xml'),
    ).toEqual(ok);
  });

  it('takes a CSV whose first letters happen to be an executable’s signature', () => {
    expect(checkDeclaredType(Buffer.from('MZ,Mozambique\nBM,Bermuda\n'), 'text/csv')).toEqual(ok);
  });

  it('refuses a program, an image and a PDF declared as text', () => {
    expect(checkDeclaredType(EXE, 'text/plain')).toEqual(refused('binary_as_text'));
    expect(checkDeclaredType(ELF, 'text/csv')).toEqual(refused('binary_as_text'));
    expect(checkDeclaredType(PNG, 'text/plain')).toEqual(refused('binary_as_text'));
    // A PDF can be pure ASCII, so it is refused by its signature, not a NUL.
    expect(checkDeclaredType(Buffer.from('%PDF-1.4\n%%EOF\n'), 'text/plain')).toEqual(
      refused('binary_as_text'),
    );
  });

  it('looks for a NUL only in the first 8,000 bytes, as git does', () => {
    const late = Buffer.concat([Buffer.alloc(8000, 0x61), Buffer.from([0])]);
    expect(checkDeclaredType(late, 'text/plain')).toEqual(ok);
    const early = Buffer.concat([Buffer.alloc(7999, 0x61), Buffer.from([0])]);
    expect(checkDeclaredType(early, 'text/plain')).toEqual(refused('binary_as_text'));
  });
});

describe('checkDeclaredType — any other type may not be a program', () => {
  it('refuses the native executable formats under a type this table does not know', () => {
    for (const program of [EXE, ELF, MACH_O]) {
      expect(checkDeclaredType(program, 'application/octet-stream')).toEqual(refused('executable'));
      expect(checkDeclaredType(program, 'image/heic')).toEqual(refused('executable'));
    }
  });

  it('takes anything else under such a type — a ZIP-based format nobody listed is still a ZIP', () => {
    expect(checkDeclaredType(spreadsheet, 'application/epub+zip')).toEqual(ok);
    expect(checkDeclaredType(Buffer.from('00010203', 'hex'), 'application/octet-stream')).toEqual(
      ok,
    );
  });
});
