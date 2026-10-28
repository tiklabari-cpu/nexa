/**
 * The files of a received mail (tm 357 · HD-02): each kept only past every
 * door — readable, an image or a PDF by its bytes, within the size limits,
 * scanned clean — and reported, never fatal, when one refuses it.
 */
import { describe, expect, it } from 'vitest';
import type { ObjectStore, StoredFile } from '../storage/object-store.js';
import { StorageUnavailableError } from '../storage/storage-error.js';
import { licenseOfKey, licenseOfMailKey } from '../storage/upload-url.js';
import {
  EICAR_SIGNATURE,
  MockVirusScanner,
  UnavailableVirusScanner,
} from '../storage/virus-scanner.js';
import {
  INBOUND_ATTACHMENT_MAX_BYTES,
  decodeBase64,
  displayName,
  namesIdentityDocument,
  rejectedAttachmentsNote,
  screenInboundAttachments,
  sniffAttachmentType,
  type InboundAttachmentInput,
} from './inbound-email-attachments.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');

function file(filename: string, bytes: Buffer, contentType = 'application/octet-stream') {
  return { filename, content_type: contentType, content_base64: bytes.toString('base64') };
}

/** An in-memory store that records what was put. */
function memoryStore(failPut = false) {
  const objects = new Map<string, StoredFile>();
  const store: ObjectStore = {
    put: async (key, bytes, contentType) => {
      if (failPut) throw new StorageUnavailableError('bucket down');
      objects.set(key, { bytes, contentType });
    },
    get: async (key) => objects.get(key) ?? null,
    exists: async (key) => objects.has(key),
    stat: async (key) => {
      const found = objects.get(key);
      return found ? { contentType: found.contentType, sizeBytes: found.bytes.length } : null;
    },
    delete: async (key) => {
      objects.delete(key);
    },
    listKnowledge: async () => [],
  };
  return { store, objects };
}

async function screen(
  files: InboundAttachmentInput[],
  overrides: {
    subject?: string;
    allSensitive?: boolean;
    failPut?: boolean;
    scanDown?: boolean;
  } = {},
) {
  const { store, objects } = memoryStore(overrides.failPut);
  const result = await screenInboundAttachments(files, {
    store,
    scanner: overrides.scanDown ? new UnavailableVirusScanner() : new MockVirusScanner(),
    licenseId: 7n,
    subject: overrides.subject ?? 'Yatırım',
    allSensitive: overrides.allSensitive ?? false,
  });
  return { ...result, objects };
}

describe('screenInboundAttachments', () => {
  it('keeps a dekont by its bytes, under an e-mailed-file key no upload door serves (HD-02)', async () => {
    const { stored, rejected, objects } = await screen([file('dekont.pdf', PDF)]);

    expect(rejected).toEqual([]);
    expect(stored).toEqual([
      {
        key: expect.stringMatching(/^7-m-[0-9a-f-]{36}\.pdf$/),
        name: 'dekont.pdf',
        size: PDF.length,
        mime: 'application/pdf',
        scan_status: 'clean',
        sensitive: false,
      },
    ]);
    const key = stored[0]!.key;
    expect(licenseOfMailKey(key)).toBe(7n);
    expect(licenseOfKey(key)).toBeNull();
    expect(objects.get(key)).toEqual({ bytes: PDF, contentType: 'application/pdf' });
  });

  it('refuses the EICAR test file and stores nothing for it', async () => {
    const eicar = Buffer.concat([PDF, Buffer.from(EICAR_SIGNATURE, 'latin1')]);
    const { stored, rejected, objects } = await screen([
      file('virus.pdf', eicar),
      file('ekran.png', PNG),
    ]);

    expect(rejected).toEqual([{ name: 'virus.pdf', reason: 'infected' }]);
    expect(stored.map((f) => f.name)).toEqual(['ekran.png']);
    expect(objects.size).toBe(1);
  });

  it('fails closed when the scanner is down: the file is reported, not kept', async () => {
    const { stored, rejected } = await screen([file('dekont.pdf', PDF)], { scanDown: true });
    expect(stored).toEqual([]);
    expect(rejected).toEqual([{ name: 'dekont.pdf', reason: 'scan_unavailable' }]);
  });

  it('trusts the bytes, not the declared type or the name', async () => {
    const { stored, rejected } = await screen([
      // An executable that says it is a PDF.
      file('dekont.pdf', Buffer.from('MZ\x90\x00 not a pdf'), 'application/pdf'),
      // HTML that says it is an image.
      file('resim.png', Buffer.from('<script>alert(1)</script>'), 'image/png'),
      // A real PNG with no useful declaration.
      file('ekran', PNG, 'application/octet-stream'),
    ]);
    expect(rejected).toEqual([
      { name: 'dekont.pdf', reason: 'type' },
      { name: 'resim.png', reason: 'type' },
    ]);
    expect(stored).toEqual([expect.objectContaining({ name: 'ekran', mime: 'image/png' })]);
  });

  it('holds a file to 10 MiB and a mail to 25 MiB, and a mail to ten files', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(INBOUND_ATTACHMENT_MAX_BYTES)]);
    const nine = Buffer.concat([PDF, Buffer.alloc(9 * 1024 * 1024)]);
    const { stored, rejected } = await screen([
      file('buyuk.pdf', big),
      file('a.pdf', nine),
      file('b.pdf', nine),
      file('c.pdf', nine),
    ]);
    expect(rejected).toEqual([
      { name: 'buyuk.pdf', reason: 'too_large' },
      { name: 'c.pdf', reason: 'over_total' },
    ]);
    expect(stored.map((f) => f.name)).toEqual(['a.pdf', 'b.pdf']);

    const many = await screen(Array.from({ length: 12 }, (_, i) => file(`${i}.png`, PNG)));
    expect(many.stored).toHaveLength(10);
    expect(many.rejected).toEqual([
      { name: '10.png', reason: 'too_many' },
      { name: '11.png', reason: 'too_many' },
    ]);
  });

  it('reports a file it cannot read or store, and goes on with the rest', async () => {
    const unreadable = await screen([
      { filename: 'x.pdf', content_type: 'application/pdf', content_base64: '%%% not base64' },
      { filename: 'bos.pdf', content_type: 'application/pdf', content_base64: '' },
    ]);
    expect(unreadable.rejected).toEqual([
      { name: 'x.pdf', reason: 'unreadable' },
      { name: 'bos.pdf', reason: 'unreadable' },
    ]);

    const down = await screen([file('dekont.pdf', PDF)], { failPut: true });
    expect(down.rejected).toEqual([{ name: 'dekont.pdf', reason: 'store_unavailable' }]);
  });

  it('marks an identity document sensitive by its name or the subject, or every file by the setting', async () => {
    const byName = await screen([file('KİMLİK_ön.jpg', PNG), file('dekont.pdf', PDF)]);
    expect(byName.stored.map((f) => [f.name, f.sensitive])).toEqual([
      ['KİMLİK_ön.jpg', true],
      ['dekont.pdf', false],
    ]);

    const bySubject = await screen([file('foto.png', PNG)], { subject: 'KYC belgelerim' });
    expect(bySubject.stored[0]!.sensitive).toBe(true);

    const bySetting = await screen([file('dekont.pdf', PDF)], { allSensitive: true });
    expect(bySetting.stored[0]!.sensitive).toBe(true);
  });
});

describe('the pieces', () => {
  it('sniffs the five kept types and nothing else', () => {
    expect(sniffAttachmentType(PNG)).toBe('image/png');
    expect(sniffAttachmentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffAttachmentType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffAttachmentType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 '))).toBe('image/webp');
    expect(sniffAttachmentType(PDF)).toBe('application/pdf');
    expect(sniffAttachmentType(Buffer.from('PK\x03\x04'))).toBeNull();
    expect(sniffAttachmentType(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });

  it('decodes mail-wrapped base64 and refuses anything else, in linear time', () => {
    expect(decodeBase64('aGVs\r\nbG8=')).toEqual(Buffer.from('hello'));
    expect(decodeBase64('not base64!')).toBeNull();
    expect(decodeBase64('abcde')).toBeNull();

    const started = Date.now();
    expect(decodeBase64(`${' '.repeat(2_000_000)}!`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('shows a name without its path or control characters', () => {
    expect(displayName('C:\\fakepath\\dekont.pdf')).toBe('dekont.pdf');
    expect(displayName('../../etc/passwd')).toBe('passwd');
    expect(displayName('a\x00b\x1f.pdf')).toBe('ab.pdf');
    expect(displayName('   ')).toBe('attachment');
  });

  it('folds Turkish case and marks for the identity words', () => {
    for (const text of [
      'kimlik.jpg',
      'KİMLİK.jpg',
      'KIMLIK.jpg',
      'Pasaport',
      'ehliyet_arka',
      'kyc',
      'Passport scan',
    ]) {
      expect(namesIdentityDocument(text), text).toBe(true);
    }
    expect(namesIdentityDocument('dekont.pdf')).toBe(false);
  });

  it('says which files were not kept and why', () => {
    expect(rejectedAttachmentsNote([{ name: 'virus.pdf', reason: 'infected' }])).toBe(
      "A file on the player's e-mail was not kept: “virus.pdf” — it did not pass the virus scan.",
    );
    expect(
      rejectedAttachmentsNote([
        { name: 'a.exe', reason: 'type' },
        { name: 'b.pdf', reason: 'too_large' },
      ]),
    ).toBe(
      "2 files on the player's e-mail were not kept: “a.exe” — only images and PDF files are kept; “b.pdf” — larger than 10 MB.",
    );
  });
});
