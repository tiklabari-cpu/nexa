/**
 * The bounded ZIP reader (tm 313.2 · AI-18): AI-18's archive ceilings hold
 * before anything is inflated, and an entry cannot inflate past what it
 * declared.
 */
import { describe, expect, it } from 'vitest';
import { zip } from '../../../../test/helpers/document-fixtures.js';
import { DocumentParseError } from './types.js';
import { DOCX_ZIP_LIMITS, openZipArchive, readZipDirectory } from './zip.js';

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DocumentParseError) return `${error.code}:${error.detail}`;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('readZipDirectory', () => {
  it('lists every entry with its sizes and method', () => {
    const directory = readZipDirectory(
      zip([
        { name: 'a.txt', data: 'stored' },
        { name: 'b.xml', data: 'x'.repeat(1000), deflate: true },
      ]),
    );
    expect(directory.ok).toBe(true);
    if (!directory.ok) return;
    expect(directory.entries.map((e) => [e.name, e.method, e.uncompressedSize])).toEqual([
      ['a.txt', 0, 6],
      ['b.xml', 8, 1000],
    ]);
    expect(directory.entries[1]!.compressedSize).toBeLessThan(100);
  });

  it('refuses an archive without an end record, and a ZIP64 one', () => {
    expect(readZipDirectory(Buffer.from('PK\x03\x04 not a zip at all', 'latin1'))).toEqual({
      ok: false,
      why: 'unreadable',
    });
    const archive = zip([{ name: 'a.txt', data: 'a' }]);
    archive.writeUInt32LE(0xffffffff, archive.length - 22 + 16); // directory offset saturated
    expect(readZipDirectory(archive)).toEqual({ ok: false, why: 'unsupported' });

    const entry = zip([{ name: 'a.txt', data: 'a' }]);
    const central = entry.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    entry.writeUInt32LE(0xffffffff, central + 24); // the entry's size saturated
    expect(readZipDirectory(entry)).toEqual({ ok: false, why: 'unsupported' });
  });
});

describe('openZipArchive', () => {
  it('reads stored and deflated entries by case-insensitive name, CRC checked', () => {
    const archive = openZipArchive(
      zip([
        { name: 'Word/Document.xml', data: '<w:document/>', deflate: true },
        { name: 'word/styles.xml', data: '<w:styles/>' },
      ]),
    );
    expect(archive.read(archive.find('word/document.xml')!).toString()).toBe('<w:document/>');
    expect(archive.read(archive.find('WORD/STYLES.XML')!).toString()).toBe('<w:styles/>');
    expect(archive.find('word/numbering.xml')).toBeNull();
  });

  it('holds AI-18 ceilings: 2,000 entries, 100 MB unpacked, 100:1', () => {
    expect(DOCX_ZIP_LIMITS).toMatchObject({
      maxEntries: 2_000,
      maxTotalBytes: 100 * 1024 * 1024,
      maxRatio: 100,
    });
  });

  it('refuses more than 2,000 entries before reading one', () => {
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `part${i}.xml`, data: '<x/>' }));
    expect(() => openZipArchive(zip(entries(2_000)))).not.toThrow();
    expect(refusal(() => openZipArchive(zip(entries(2_001))))).toBe(
      'parse_failed:zip_too_many_entries',
    );
  });

  it('refuses an archive whose entries declare more than the total, before inflating', () => {
    const archive = zip([
      { name: 'a.xml', data: 'a'.repeat(600) },
      { name: 'b.xml', data: 'b'.repeat(600) },
    ]);
    expect(
      refusal(() => openZipArchive(archive, { ...DOCX_ZIP_LIMITS, maxTotalBytes: 1_000 })),
    ).toBe('parse_failed:zip_too_large');
    expect(() =>
      openZipArchive(archive, { ...DOCX_ZIP_LIMITS, maxTotalBytes: 1_200 }),
    ).not.toThrow();
  });

  it('refuses a compression bomb by its ratio, and lets small repetitive parts through', () => {
    // 20 MiB of zeros deflate to ~20 KB: a 1000:1 entry.
    const bomb = zip([
      { name: 'word/document.xml', data: Buffer.alloc(20 * 1024 * 1024), deflate: true },
    ]);
    expect(bomb.length).toBeLessThan(100 * 1024);
    expect(refusal(() => openZipArchive(bomb))).toBe('parse_failed:zip_ratio');

    // 64 KiB of one byte is far past 100:1 too, but under the grace an entry gets.
    const small = zip([
      { name: 'word/settings.xml', data: Buffer.alloc(64 * 1024, 0x61), deflate: true },
    ]);
    const archive = openZipArchive(small);
    expect(archive.read(archive.find('word/settings.xml')!).length).toBe(64 * 1024);
  });

  it('stops an entry that inflates past the size it declared', () => {
    const lying = zip([
      {
        name: 'word/document.xml',
        data: Buffer.alloc(4 * 1024 * 1024, 0x61),
        deflate: true,
        declaredSize: 1_000,
      },
    ]);
    const archive = openZipArchive(lying);
    expect(refusal(() => archive.read(archive.find('word/document.xml')!))).toBe(
      'parse_failed:zip_inflate',
    );
  });

  it('refuses a damaged entry, an encrypted one, a twice-named one and a disagreeing local header', () => {
    const damaged = zip([{ name: 'a.xml', data: 'hello world' }]);
    damaged[damaged.indexOf('hello')] = 0x6a; // 'jello'
    const one = openZipArchive(damaged);
    expect(refusal(() => one.read(one.find('a.xml')!))).toBe('parse_failed:zip_crc');

    const encrypted = zip([{ name: 'a.xml', data: 'secret' }]);
    const central = encrypted.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    encrypted.writeUInt16LE(0x0801, central + 8); // general purpose bit 0
    const two = openZipArchive(encrypted);
    expect(refusal(() => two.read(two.find('a.xml')!))).toBe('parse_failed:zip_encrypted');

    expect(
      refusal(() =>
        openZipArchive(
          zip([
            { name: 'word/document.xml', data: '<a/>' },
            { name: 'WORD/document.xml', data: '<b/>' },
          ]),
        ),
      ),
    ).toBe('parse_failed:zip_duplicate_name');

    const renamed = zip([{ name: 'a.xml', data: '<a/>' }]);
    renamed.write('b', 30, 'latin1'); // the local header now says b.xml
    const three = openZipArchive(renamed);
    expect(refusal(() => three.read(three.find('a.xml')!))).toBe('parse_failed:zip_unreadable');
  });
});
