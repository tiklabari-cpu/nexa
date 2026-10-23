/**
 * Check a GeoIP database file before it goes live (GEOIP-COUNTRY · tm 330,
 * `docs/runbooks/geoip-database.md`):
 *
 *   pnpm --filter @siyahtus/api exec tsx scripts/geoip-check.ts <file.mmdb> [ip …]
 *
 * Loads the file exactly as the API does at boot (`createGeoLocator`), prints
 * its type and build date, and looks up each address given. Exit 1 when the
 * file does not load — the API would run with countries switched off. Offline:
 * reads the file, nothing else.
 */
import { createGeoLocator } from '../src/services/geo/geo-locator.js';

const [path, ...ips] = process.argv.slice(2);
if (!path) {
  console.error('usage: tsx scripts/geoip-check.ts <file.mmdb> [ip …]');
  process.exitCode = 2;
} else {
  const { locator, warning } = createGeoLocator(path);
  const status = locator.status();
  console.log(
    JSON.stringify({ status, lookups: ips.map((ip) => ({ ip, ...locator.locate(ip) })) }, null, 2),
  );
  if (warning) console.error(warning);
  if (status.state !== 'ok') process.exitCode = 1;
}
