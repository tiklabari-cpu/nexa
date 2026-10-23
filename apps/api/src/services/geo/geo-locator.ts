/**
 * IP → country (and city), inside this process (GEOIP-COUNTRY · tm 330 ·
 * IN-02 · EN-03 · AU-02).
 *
 * One component for the three surfaces that need a visitor's country — the
 * player card, campaign targeting and country routing — so they cannot
 * disagree about where somebody is. The lookup reads an offline database
 * file (`GEOIP_DB_PATH`, MaxMind DB format: DB-IP Lite or GeoLite2 — see
 * `docs/runbooks/geoip-database.md`):
 *
 *  - the address never leaves the process — no HTTP, no DNS, nothing a
 *    third party could log (EN-03-S1);
 *  - the address is not stored or logged here; callers keep only the
 *    answer, a country code and a city name (IN-02-S1: no map, no
 *    coordinates);
 *  - without a file the feature is off, not the API: `locate` answers `null`
 *    and the boot logs a warning, never refuses.
 */
import { readFileSync } from 'node:fs';
import { parseAddress } from '../../lib/ip-allowlist.js';
import { MmdbReader, type MmdbValue } from './mmdb.js';

export interface GeoLocation {
  /** ISO 3166-1 alpha-2, upper case. */
  countryCode: string | null;
  /** The city's English name, when the database has one. */
  city: string | null;
}

/**
 * The component's state for the root panel (389.14 ·
 * `reportComponentStatus('geoip', …)`): which file is loaded and how old it
 * is — the database is a deployment artifact that ages, and an old one
 * places new address blocks wrongly.
 */
export interface GeoStatus {
  state: 'ok' | 'disabled' | 'error';
  detail: {
    db_type: string | null;
    /** The file's build date (`YYYY-MM-DD`) — the version DB-IP and MaxMind publish under. */
    db_version: string | null;
    built_at: string | null;
    error?: string;
  };
}

export interface GeoLocator {
  /** Where `ip` is, or `null` when unknown — never throws. */
  locate(ip: string | null | undefined): GeoLocation | null;
  status(): GeoStatus;
}

const COUNTRY_CODE = /^[A-Z]{2}$/;
/** City names are free text from the file; bounded before they reach a column. */
const CITY_MAX = 128;

export class MmdbGeoLocator implements GeoLocator {
  constructor(private readonly reader: MmdbReader) {}

  locate(ip: string | null | undefined): GeoLocation | null {
    if (!ip) return null;
    const address = parseAddress(ip);
    if (!address) return null;
    try {
      return toLocation(this.reader.lookup(address.bytes));
    } catch {
      // A corrupt region of the file costs this visitor their country, not
      // their request. Nothing is logged: the line would have to say whose
      // address it was to be useful.
      return null;
    }
  }

  status(): GeoStatus {
    const { databaseType, buildEpoch } = this.reader.metadata;
    const built = buildEpoch > 0 ? new Date(buildEpoch * 1000) : null;
    return {
      state: 'ok',
      detail: {
        db_type: databaseType,
        db_version: built ? built.toISOString().slice(0, 10) : null,
        built_at: built ? built.toISOString() : null,
      },
    };
  }
}

/** No database configured, or the file could not be read. */
export class DisabledGeoLocator implements GeoLocator {
  constructor(private readonly error?: string) {}

  locate(): GeoLocation | null {
    return null;
  }

  status(): GeoStatus {
    return {
      state: this.error ? 'error' : 'disabled',
      detail: {
        db_type: null,
        db_version: null,
        built_at: null,
        ...(this.error ? { error: this.error } : {}),
      },
    };
  }
}

/**
 * A locator answering from a fixed table — the tests' reader (no file, no
 * network). Addresses are matched exactly, after the same normalisation the
 * real reader applies (`::ffff:a.b.c.d` is `a.b.c.d`).
 */
export class StaticGeoLocator implements GeoLocator {
  readonly calls: string[] = [];
  readonly #table: Map<string, GeoLocation>;

  constructor(table: Record<string, GeoLocation>) {
    this.#table = new Map(Object.entries(table).map(([ip, location]) => [key(ip), location]));
  }

  locate(ip: string | null | undefined): GeoLocation | null {
    if (!ip) return null;
    this.calls.push(ip);
    return this.#table.get(key(ip)) ?? null;
  }

  status(): GeoStatus {
    return {
      state: 'ok',
      detail: { db_type: 'static', db_version: null, built_at: null },
    };
  }
}

function key(ip: string): string {
  const address = parseAddress(ip);
  return address ? Buffer.from(address.bytes).toString('hex') : ip;
}

/**
 * The locator `GEOIP_DB_PATH` names. Never throws: a missing or unreadable
 * file turns the feature off and says why in `warning`, for the boot log.
 */
export function createGeoLocator(path: string | undefined): {
  locator: GeoLocator;
  warning: string | null;
} {
  if (!path) return { locator: new DisabledGeoLocator(), warning: null };
  try {
    const reader = new MmdbReader(readFileSync(path));
    return { locator: new MmdbGeoLocator(reader), warning: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      locator: new DisabledGeoLocator(reason),
      warning: `GEOIP_DB_PATH could not be loaded, visitor countries stay empty: ${reason}`,
    };
  }
}

/** The two fields GeoLite2 and DB-IP share, read defensively from a record. */
function toLocation(record: MmdbValue | null): GeoLocation | null {
  if (!isMap(record)) return null;
  const country = isMap(record.country) ? record.country.iso_code : undefined;
  const countryCode =
    typeof country === 'string' && COUNTRY_CODE.test(country.toUpperCase())
      ? country.toUpperCase()
      : null;
  const names = isMap(record.city) && isMap(record.city.names) ? record.city.names : undefined;
  const cityName = names?.en;
  const city =
    typeof cityName === 'string' && cityName.trim() !== ''
      ? cityName.trim().slice(0, CITY_MAX)
      : null;
  if (countryCode === null && city === null) return null;
  return { countryCode, city };
}

function isMap(value: MmdbValue | null | undefined): value is { [key: string]: MmdbValue } {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}

declare module 'fastify' {
  interface FastifyInstance {
    /** IP → country for widget visitors (tm 330); `buildServer` decorates it. */
    geo: GeoLocator;
  }
}
