import { describe, expect, it } from 'vitest';
import { DEFAULT_BULK_FILE_LIMITS, precheckBulkFile, readBulkFile } from './bulk-file.js';

function csvFile(content: string, name = 'sources.csv', type = 'text/csv'): File {
  return new File([content], name, { type });
}

const VALID_CSV = 'name,type,content,source_url\r\nReturn policy,article,Ships in 3 days,\r\n';

describe('precheckBulkFile', () => {
  it('rejects a non-.csv extension as invalid_type', () => {
    const result = precheckBulkFile(csvFile(VALID_CSV, 'sources.txt', 'text/plain'));
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_type',
      message: expect.any(String),
    });
  });

  it('rejects an obviously wrong MIME type even with a .csv name', () => {
    const result = precheckBulkFile(csvFile(VALID_CSV, 'sources.csv', 'image/png'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_type');
  });

  it('accepts a .csv file reported with no MIME type at all', () => {
    const result = precheckBulkFile(csvFile(VALID_CSV, 'sources.csv', ''));
    expect(result.ok).toBe(true);
  });

  it('rejects a 0-byte file as empty_file', () => {
    const result = precheckBulkFile(csvFile('', 'empty.csv'));
    expect(result).toEqual({ ok: false, reason: 'empty_file', message: expect.any(String) });
  });

  it('rejects a file over the size ceiling as too_large, naming the ceiling in the reason', () => {
    const limits = { maxBytes: 10 };
    const result = precheckBulkFile(csvFile('x'.repeat(20), 'big.csv'), limits);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('too_large');
      expect(result.message).toContain('MiB');
    }
  });

  it('accepts a valid .csv file within the size ceiling', () => {
    const result = precheckBulkFile(csvFile(VALID_CSV, 'sources.csv'), { maxBytes: 1_000 });
    expect(result).toEqual({ ok: true });
  });

  it('mirrors the server bulk-import content ceiling (5 MiB)', () => {
    expect(DEFAULT_BULK_FILE_LIMITS.maxBytes).toBe(5_242_880);
  });
});

describe('readBulkFile', () => {
  it('converts a valid .csv file to text', async () => {
    const result = await readBulkFile(csvFile(VALID_CSV));
    expect(result).toEqual({ ok: true, text: VALID_CSV });
  });

  it('loses no content in a file that opens with a BOM (the BOM itself is decoded away, per the UTF-8 decode)', async () => {
    const withBom = `\uFEFF${VALID_CSV}`;
    const result = await readBulkFile(csvFile(withBom));
    expect(result).toEqual({ ok: true, text: VALID_CSV });
  });

  it('rejects a non-.csv extension without reading it', async () => {
    const result = await readBulkFile(csvFile(VALID_CSV, 'sources.txt', 'text/plain'));
    expect(result).toEqual({ ok: false, reason: 'invalid_type', message: expect.any(String) });
  });

  it('rejects a 0-byte file as empty_file', async () => {
    const result = await readBulkFile(csvFile('', 'empty.csv'));
    expect(result).toEqual({ ok: false, reason: 'empty_file', message: expect.any(String) });
  });

  it('rejects a whitespace-only file as empty_file, even though its byte size is non-zero', async () => {
    const result = await readBulkFile(csvFile('   \r\n \r\n'));
    expect(result).toEqual({ ok: false, reason: 'empty_file', message: expect.any(String) });
  });

  it('rejects a file over the size ceiling as too_large', async () => {
    const result = await readBulkFile(csvFile(VALID_CSV, 'sources.csv'), { maxBytes: 5 });
    expect(result).toEqual({ ok: false, reason: 'too_large', message: expect.any(String) });
  });
});
