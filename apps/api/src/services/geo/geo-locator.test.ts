/**
 * The offline IP → country reader (GEOIP-COUNTRY · tm 330). Every database here
 * is written by the test itself (`test/helpers/mmdb-writer.ts`), so the reader
 * is checked against records whose every byte is known — no download, no
 * licensed file, no network.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeMmdb, type MmdbEntry } from '../../../test/helpers/mmdb-writer.js';
import {
  createGeoLocator,
  DisabledGeoLocator,
  MmdbGeoLocator,
  StaticGeoLocator,
} from './geo-locator.js';
import { MmdbReader } from './mmdb.js';

const city = (iso: string, name: string) => ({
  continent: { code: 'EU', names: { en: 'Europe' } },
  country: { iso_code: iso, geoname_id: 298_795, names: { en: 'Turkey', de: 'Türkei' } },
  city: { names: { en: name } },
  location: { latitude: 41.0138, longitude: 28.9497 },
});

const ENTRIES: MmdbEntry[] = [
  { network: '81.214.0.0/16', record: city('TR', 'Istanbul') },
  // A second record sharing every repeated string with the first — written
  // as pointers, the way real files are.
  { network: '88.230.0.0/15', record: city('TR', 'Ankara') },
  { network: '5.9.0.0/16', record: { country: { iso_code: 'DE' } } },
  { network: '2a02:e00::/29', record: city('DE', 'Berlin') },
  // Country only, lower-cased in the file: still read as `GB`.
  { network: '51.140.0.0/14', record: { country: { iso_code: 'gb' } } },
  // City only: a record the file holds without a country.
  { network: '100.64.0.0/10', record: { city: { names: { en: 'Somewhere' } } } },
];

const locatorFor = (entries: MmdbEntry[], options?: Parameters<typeof writeMmdb>[1]) =>
  new MmdbGeoLocator(new MmdbReader(writeMmdb(entries, options)));

describe('MmdbGeoLocator', () => {
  it.each([24, 28, 32] as const)(
    'finds the country and city of an IPv4 address (record size %i)',
    (recordSize) => {
      const geo = locatorFor(ENTRIES, { recordSize });
      expect(geo.locate('81.214.10.20')).toEqual({ countryCode: 'TR', city: 'Istanbul' });
      expect(geo.locate('88.231.255.1')).toEqual({ countryCode: 'TR', city: 'Ankara' });
      expect(geo.locate('5.9.200.1')).toEqual({ countryCode: 'DE', city: null });
    },
  );

  it('reads IPv6 addresses and IPv4-mapped IPv6 addresses', () => {
    const geo = locatorFor(ENTRIES);
    expect(geo.locate('2a02:e00:1::5')).toEqual({ countryCode: 'DE', city: 'Berlin' });
    // How Node reports an IPv4 client on a dual-stack socket.
    expect(geo.locate('::ffff:81.214.1.2')).toEqual({ countryCode: 'TR', city: 'Istanbul' });
  });

  it('normalises the country code and keeps a city-only record', () => {
    const geo = locatorFor(ENTRIES);
    expect(geo.locate('51.140.1.1')).toEqual({ countryCode: 'GB', city: null });
    expect(geo.locate('100.64.0.1')).toEqual({ countryCode: null, city: 'Somewhere' });
  });

  it('answers null for addresses the file does not hold, and for non-addresses', () => {
    const geo = locatorFor(ENTRIES);
    expect(geo.locate('9.9.9.9')).toBeNull();
    expect(geo.locate('127.0.0.1')).toBeNull();
    expect(geo.locate('2001:db8::1')).toBeNull();
    expect(geo.locate('')).toBeNull();
    expect(geo.locate(null)).toBeNull();
    expect(geo.locate(undefined)).toBeNull();
    expect(geo.locate('not an ip')).toBeNull();
    expect(geo.locate('81.214.10.300')).toBeNull();
  });

  it('reads an IPv4-only database, where an IPv6 address has no answer', () => {
    const geo = locatorFor(
      ENTRIES.filter((e) => !e.network.includes(':')),
      { ipVersion: 4 },
    );
    expect(geo.locate('81.214.10.20')).toEqual({ countryCode: 'TR', city: 'Istanbul' });
    expect(geo.locate('2a02:e00:1::5')).toBeNull();
  });

  it('bounds a long city name and decodes long strings in a record', () => {
    const long = 'x'.repeat(300); // a 300-byte string uses the two-byte size form
    const geo = locatorFor([
      {
        network: '81.214.0.0/16',
        record: {
          country: { iso_code: 'TR' },
          city: { names: { en: long } },
          note: 'y'.repeat(70_000),
        },
      },
    ]);
    expect(geo.locate('81.214.0.1')).toEqual({ countryCode: 'TR', city: 'x'.repeat(128) });
  });

  it('ignores a country code that is not two letters', () => {
    const geo = locatorFor([
      { network: '81.214.0.0/16', record: { country: { iso_code: 'TUR' } } },
    ]);
    expect(geo.locate('81.214.0.1')).toBeNull();
  });

  it('reports the loaded file for the root panel (389.14)', () => {
    const geo = locatorFor(ENTRIES, { databaseType: 'DBIP-City-Lite', buildEpoch: 1_759_276_800 });
    expect(geo.status()).toEqual({
      state: 'ok',
      detail: {
        db_type: 'DBIP-City-Lite',
        db_version: '2025-10-01',
        built_at: '2025-10-01T00:00:00.000Z',
      },
    });
  });

  it('survives a truncated data section: that lookup answers null, nothing throws', () => {
    const full = writeMmdb(ENTRIES);
    const reader = new MmdbReader(full);
    // Cut the data section short while keeping the metadata readable: the
    // tree still points into the gap.
    const marker = full.lastIndexOf(Buffer.from('MaxMind.com', 'ascii')) - 3;
    const treeAndSeparator = reader.metadata.nodeCount * 6 + 16;
    const broken = Buffer.concat([full.subarray(0, treeAndSeparator + 4), full.subarray(marker)]);
    const geo = new MmdbGeoLocator(new MmdbReader(broken));
    expect(() => geo.locate('88.230.0.1')).not.toThrow();
    expect(geo.locate('88.230.0.1')).toBeNull();
  });

  it('refuses a file that is not a MaxMind DB', () => {
    expect(() => new MmdbReader(Buffer.from('definitely not a database'))).toThrow(/metadata/);
  });
});

describe('the address never leaves the process (EN-03-S1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('answers without any network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('the locator must not use the network');
    });
    const geo = locatorFor(ENTRIES);
    expect(geo.locate('81.214.10.20')).toEqual({ countryCode: 'TR', city: 'Istanbul' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('imports nothing that could reach the network', () => {
    // A static guard on the module graph: the lookup is a file read, so the
    // only module from node it may use is `fs`. `ip-allowlist.ts` is the
    // address parser and is pure (its own imports are checked too).
    const here = dirname(fileURLToPath(import.meta.url));
    const files = [
      ...readdirSync(here)
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => join(here, f)),
      join(here, '../../lib/ip-allowlist.ts'),
      join(here, '../../lib/banned-ip.ts'),
    ];
    const allowed = new Set(['node:fs', 'node:net']);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const [, spec] of source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)) {
        if (spec!.startsWith('.')) continue;
        expect(allowed, `${file} imports ${spec}`).toContain(spec);
      }
    }
  });
});

describe('createGeoLocator', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tempFile = (content: Buffer): string => {
    const dir = mkdtempSync(join(tmpdir(), 'siyahtus-geo-'));
    dirs.push(dir);
    const path = join(dir, 'db.mmdb');
    writeFileSync(path, content);
    return path;
  };

  it('is off, quietly, when no file is configured', () => {
    const { locator, warning } = createGeoLocator(undefined);
    expect(locator).toBeInstanceOf(DisabledGeoLocator);
    expect(warning).toBeNull();
    expect(locator.locate('81.214.10.20')).toBeNull();
    expect(locator.status().state).toBe('disabled');
  });

  it('loads the configured file', () => {
    const { locator, warning } = createGeoLocator(tempFile(writeMmdb(ENTRIES)));
    expect(warning).toBeNull();
    expect(locator.locate('81.214.10.20')).toEqual({ countryCode: 'TR', city: 'Istanbul' });
  });

  it('turns the feature off with a warning — never a failed boot — when the file is bad', () => {
    for (const path of [join(tmpdir(), 'siyahtus-geo-missing.mmdb'), tempFile(Buffer.from('x'))]) {
      const { locator, warning } = createGeoLocator(path);
      expect(warning).toMatch(/^GEOIP_DB_PATH could not be loaded/);
      expect(locator.locate('81.214.10.20')).toBeNull();
      expect(locator.status().state).toBe('error');
    }
  });
});

describe('StaticGeoLocator', () => {
  it('answers from its table after the same address normalisation', () => {
    const geo = new StaticGeoLocator({ '81.214.10.20': { countryCode: 'TR', city: null } });
    expect(geo.locate('::ffff:81.214.10.20')).toEqual({ countryCode: 'TR', city: null });
    expect(geo.locate('1.1.1.1')).toBeNull();
    expect(geo.calls).toEqual(['::ffff:81.214.10.20', '1.1.1.1']);
  });
});
