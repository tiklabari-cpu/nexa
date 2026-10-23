# Runbook: the GeoIP database (visitor country)

The API finds a widget visitor's country and city from their IP address
(GEOIP-COUNTRY · tm 330). The lookup runs **inside the API process** against an
offline database file; the address is not sent anywhere and the lookup does not
store it. Only the answer is kept: `visits.country_code` + `visits.city` for the
visit, and `customers.country_code` when the contact has none yet. No
coordinates, no map.

Code: `apps/api/src/services/geo/` (`mmdb.ts` reads the file, `geo-locator.ts`
answers). Setting: `GEOIP_DB_PATH`. Without it — or with a file that cannot be
read — countries stay empty, the boot logs `geoip.disabled` once and goes on.

## Which database (licence decision)

Both supported products ship the same MaxMind DB (`.mmdb`) format; the API
reads either, nothing else changes.

|             | **DB-IP IP to City Lite** (chosen default)      | MaxMind GeoLite2 City                                                            |
| ----------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Licence     | CC BY 4.0                                       | GeoLite2 EULA                                                                    |
| Account     | none                                            | MaxMind account + licence key                                                    |
| Updates     | monthly                                         | twice weekly                                                                     |
| Obligations | attribution                                     | attribution; replace or delete a superseded file within 30 days; EULA use limits |
| Download    | <https://db-ip.com/db/download/ip-to-city-lite> | <https://www.maxmind.com/en/accounts/current/geoip/downloads>                    |

**Decision (tm 330):** DB-IP IP to City Lite. It needs no account or key to
store, its licence is a standard one, and monthly freshness is enough for a
country and a city. GeoLite2 stays possible without a code change if the owner
prefers it.

**Owner action — attribution.** CC BY 4.0 requires a credit wherever the
data is used. Add this line to the deployment's legal notices (the privacy
policy behind `PRIVACY_POLICY_URL` is the natural place):
`IP geolocation by DB-IP (https://db-ip.com), licensed under CC BY 4.0.`
The product shows no attribution of its own yet. For GeoLite2 the wording is
`This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.`

## Install / monthly update

The file is a deployment artifact, like a certificate: not in the repository,
not in the image, not changeable from a panel. It is read once at boot.

1. Download the new month's `dbip-city-lite-YYYY-MM.mmdb.gz` and unpack it.
2. Check it before it goes live — loads as the API would, prints its build
   date and a few lookups, exit 1 if it does not load:

   ```bash
   pnpm --filter @siyahtus/api exec tsx scripts/geoip-check.ts ./dbip-city-lite-2026-11.mmdb 81.214.10.20 8.8.8.8
   ```

3. Put it next to the old one under its dated name, then point the stable path
   at it in one step (`mv` within one filesystem, or a symlink switch), so a
   restarting pod never reads a half-copied file:

   ```bash
   install -m 0644 dbip-city-lite-2026-11.mmdb /var/lib/siyahtus/geoip/
   ln -sfn dbip-city-lite-2026-11.mmdb /var/lib/siyahtus/geoip/current.mmdb
   ```

   Mount the directory read-only into the api container and set
   `GEOIP_DB_PATH=/var/lib/siyahtus/geoip/current.mmdb`.

4. Restart the api (rolling, one pod at a time). Nothing to migrate; visits
   already recorded keep the answer they got.
5. Remove files older than the previous month (GeoLite2's EULA requires this
   within 30 days; for DB-IP it is housekeeping).

## Symptoms

- **Every new visit has an empty country.** Look for `geoip.disabled` in the
  api's boot log: the path is unset, or the file is missing or corrupt. Run the
  check script on the path the container sees.
- **Countries look wrong for one network.** The file is old: the build date
  from the check script (and the root panel's `geoip` component status, 389.14)
  says how old. Update it.
- **One visitor's country is wrong.** Expected sometimes: free databases place
  mobile networks and VPNs approximately. An agent can correct the contact's
  country by hand; a later visit does not overwrite a country the contact
  already has.

## Data protection

- The lookup sees the address for the length of one function call. It is not
  logged and not written by this component. (The visit's own `visits.ip`
  column predates it and follows the visit retention window, NFR-S9.)
- Country and city are deleted with the visit (`RETENTION_VISIT_DAYS`) and with
  the contact (erasure).
