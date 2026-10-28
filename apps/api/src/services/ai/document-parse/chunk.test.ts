/**
 * Blocks packed into chunks (tm 313.3 · AI-18): ~600 characters, never across
 * a heading, with the pages and heading of what each chunk took.
 */
import { describe, expect, it } from 'vitest';
import { DOCUMENT_CHUNK_CHARS, chunkDocument } from './chunk.js';
import type { DocumentBlock } from './types.js';

const heading = (text: string, page: number, level = 1): DocumentBlock => ({
  kind: 'heading',
  level,
  text,
  pageFrom: page,
  pageTo: page,
});
const paragraph = (text: string, from: number, to = from): DocumentBlock => ({
  kind: 'paragraph',
  text,
  pageFrom: from,
  pageTo: to,
});
const row = (text: string, page: number): DocumentBlock => ({
  kind: 'table_row',
  text,
  pageFrom: page,
  pageTo: page,
});

describe('chunkDocument (FR-MOD-06.3.2)', () => {
  it('packs short blocks into one chunk that spans their pages', () => {
    const chunks = chunkDocument([
      paragraph('Çevrim şartı 35 kattır.', 1),
      paragraph('Çekim limiti günlük 5.000 TL.', 2),
    ]);
    expect(chunks).toEqual([
      {
        text: 'Çevrim şartı 35 kattır.\nÇekim limiti günlük 5.000 TL.',
        pageFrom: 1,
        pageTo: 2,
        heading: null,
      },
    ]);
  });

  it('opens a chunk with its heading and never crosses the next one', () => {
    const chunks = chunkDocument([
      heading('Bonus şartları', 1),
      paragraph('Hoş geldin bonusu 500 TL’ye kadardır.', 1),
      heading('Çekimler', 2),
      paragraph('Çekimler 24 saat içinde işlenir.', 2),
    ]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      text: 'Bonus şartları\nHoş geldin bonusu 500 TL’ye kadardır.',
      heading: 'Bonus şartları',
      pageFrom: 1,
      pageTo: 1,
    });
    expect(chunks[1]).toMatchObject({ heading: 'Çekimler', pageFrom: 2, pageTo: 2 });
    expect(chunks[1]!.text).not.toContain('Bonus');
  });

  it('closes a chunk at the size and carries the heading into the next one', () => {
    const line = 'x'.repeat(250);
    const chunks = chunkDocument([
      heading('Şartlar', 1),
      paragraph(line, 1),
      paragraph(line, 2),
      paragraph(line, 3),
    ]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const piece of chunks) {
      expect(piece.text.length).toBeLessThanOrEqual(DOCUMENT_CHUNK_CHARS);
      expect(piece.heading).toBe('Şartlar');
    }
    // Pages follow the blocks taken: the last chunk holds page 3 and nothing later.
    expect(chunks.at(-1)!.pageTo).toBe(3);
    expect(chunks[0]!.pageFrom).toBe(1);
  });

  it('cuts a block longer than a chunk by sentence, every piece on the block’s pages', () => {
    const sentence = 'Bu cümle bir kural anlatır ve yaklaşık altmış karakter uzunluğundadır. ';
    const long = sentence.repeat(30).trim();
    const chunks = chunkDocument([paragraph(long, 4, 5)]);
    expect(chunks.length).toBeGreaterThan(2);
    for (const piece of chunks) {
      expect(piece.text.length).toBeLessThanOrEqual(DOCUMENT_CHUNK_CHARS);
      expect(piece).toMatchObject({ pageFrom: 4, pageTo: 5 });
    }
  });

  it('keeps table rows one per line', () => {
    const chunks = chunkDocument([row('| Ürün | Fiyat |', 1), row('| A | 5 |', 1)]);
    expect(chunks).toEqual([
      { text: '| Ürün | Fiyat |\n| A | 5 |', pageFrom: 1, pageTo: 1, heading: null },
    ]);
  });

  it('drops a heading with nothing under it, unless the document is only headings', () => {
    const kept = chunkDocument([
      heading('Başlık sayfası', 1),
      heading('Madde 1', 2),
      paragraph('Metin.', 2),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.text).toBe('Madde 1\nMetin.');

    const only = chunkDocument([heading('Yalnız başlık', 1)]);
    expect(only).toEqual([
      { text: 'Yalnız başlık', pageFrom: 1, pageTo: 1, heading: 'Yalnız başlık' },
    ]);
  });

  it('clips a very long heading label but not the text', () => {
    const title = 'B'.repeat(400);
    const [piece] = chunkDocument([heading(title, 1), paragraph('Metin.', 1)]);
    expect(piece!.heading!.length).toBeLessThanOrEqual(200);
    expect(piece!.text.startsWith(title)).toBe(true);
  });

  it('gives an empty document no chunks', () => {
    expect(chunkDocument([])).toEqual([]);
    expect(chunkDocument([paragraph('   ', 1)])).toEqual([]);
  });
});
