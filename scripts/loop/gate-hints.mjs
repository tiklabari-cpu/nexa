// `pnpm test:gate` kırmızı bir birim/entegrasyon dosyası için tek satırlık yeniden koşu komutu basar.
// Komut paketin kendi koşucusuna göre değişir; tek biçim (api'nin with-test-datastores'u) web/types/
// widget/mobil için hemen düşüyordu (tm 316.2, tm 403). Saf fonksiyon: gate'in kendisi import'ta koşar,
// bu yüzden mantık burada ve `gate-hints.test.mjs` ile sınanır.

/** Turbo önekli ya da öneksiz `FAIL  <dosya>.test.ts[x]` satırı; önek yoksa paket api sayılır. */
const FAIL_LINE = [
  /^(?:(@siyahtus\/[\w-]+):[\w:-]+:\s+)?FAIL\s+(\S+\.test\.tsx?)/,
  /^(@siyahtus\/[\w-]+):[\w:-]+:\s+FAIL\s+(\S+\.test\.tsx?)/,
];

/** Paket adı → çalışma dizini (kökten). Bilinmeyen paket `apps/<ad>` varsayılır. */
const PACKAGE_DIRS = {
  '@siyahtus/ai-mock': 'packages/ai-mock',
  '@siyahtus/ai-templates': 'packages/ai-templates',
  '@siyahtus/contract': 'packages/contract',
  '@siyahtus/types': 'packages/types',
};

function packageDir(pkg) {
  return PACKAGE_DIRS[pkg] ?? `apps/${pkg.replace(/^@siyahtus\//, '')}`;
}

/** Bir paketin kırmızı dosyaları için tek yeniden koşu komutu. */
export function rerunCommand(pkg, files) {
  const list = files.join(' ');
  // api: kendi veritabanı + Redis; script paketin kendi scripts/ klasöründe.
  if (pkg === '@siyahtus/api')
    return `pnpm --filter ${pkg} exec tsx scripts/with-test-datastores.ts vitest run ${list}`;
  // rtm: aynı script, api'nin klasöründen.
  if (pkg === '@siyahtus/rtm')
    return `pnpm --filter ${pkg} exec tsx ../api/scripts/with-test-datastores.ts vitest run ${list}`;
  // mobil: jest (vitest değil).
  if (pkg === '@siyahtus/mobile') return `cd ${packageDir(pkg)} && npx jest ${list}`;
  // web, admin, widget, types, contract, ai-*: veritabanı gerekmez, doğrudan vitest.
  return `cd ${packageDir(pkg)} && npx vitest run ${list}`;
}

/** Gate adım günlüğünden (renk kodları atılmış) paket başına bir komut; aynı dosya bir kez. */
export function rerunHints(logText) {
  const byPackage = new Map();
  const text = logText.replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    let m = null;
    for (const re of FAIL_LINE) {
      m = re.exec(trimmed);
      if (m) break;
    }
    if (!m) continue;
    const pkg = m[1] ?? '@siyahtus/api';
    if (!byPackage.has(pkg)) byPackage.set(pkg, new Set());
    byPackage.get(pkg).add(m[2]);
  }
  return [...byPackage].map(([pkg, files]) => rerunCommand(pkg, [...files]));
}
