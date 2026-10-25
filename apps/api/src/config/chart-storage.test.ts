/**
 * Pins the Helm chart's storage configuration against the code that reads it
 * (tm 242, M-STORE · NFR-R1 · audit finding D6).
 *
 * The defect this exists for was never a bug in a function. tm 177 shipped an
 * S3-compatible `ObjectStore`, proved it across two real pods, and closed;
 * `infra/helm/siyahtus/values.yaml` went on selecting `STORAGE_PROVIDER: local`
 * while giving api an HPA ceiling of four pods, and went on carrying a comment
 * that said "STORAGE_PROVIDERS only has 'local' today" for a week after `s3`
 * shipped. Nothing failed to compile, render or test — a manifest and the code
 * it configures are connected by nobody, exactly like the
 * entrypoint/ConfigMap pair `migrate-on-start.test.ts` pins, and the technique
 * here is the same one for the same reason.
 *
 * What that disconnect costs is measured, not argued:
 * `apps/api/test/integration/two-pod.test.ts` runs a `local-a`/`local-b`
 * control group as four real OS processes — the pod that took an upload
 * answers 200, the other answers 404, and an event carrying that
 * `attachment_url` is refused by the other pod with 400 "a file this workspace
 * uploaded". A 400 is never retried and no 4xx wakes anyone.
 *
 * So the assertions below are about the *combination*, not about either half:
 * pod-local uploads are perfectly correct at one pod and broken at two, and a
 * chart is allowed to choose either shape as long as it chooses both halves
 * together.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STORAGE_PROVIDERS } from '../services/storage/object-store.js';
import { parseEnv } from './env.js';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string): string => readFileSync(resolve(REPO_ROOT, path), 'utf8');

const CHART_VALUES = 'infra/helm/siyahtus/values.yaml';
const CHART_SECRET = 'infra/helm/siyahtus/templates/secret.yaml';

/** The one provider whose bytes never leave the pod that received them. */
const POD_LOCAL_PROVIDERS = new Set(['local']);

type YamlNode = string | { [key: string]: YamlNode };

/**
 * The smallest reader that covers `values.yaml`: nested maps of scalars, two
 * space indentation, `#` comments.
 *
 * A real YAML parser would be better and is not available here — `apps/api`
 * depends on no YAML library, and adding one to assert five values would be a
 * production dependency bought for a test. The file this reads is one this
 * repository writes and the assertions below fail loudly on anything this
 * cannot express (an unsupported line throws rather than being skipped), so
 * the narrow subset is a checked assumption rather than a silent one.
 */
function parseSimpleYaml(source: string): Record<string, YamlNode> {
  const root: Record<string, YamlNode> = {};
  const stack: Array<{ indent: number; node: Record<string, YamlNode> }> = [
    { indent: -1, node: root },
  ];

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const entry = /^([A-Za-z_][A-Za-z0-9_.-]*):(?:\s+(.*))?$/.exec(trimmed);
    if (!entry) throw new Error(`${CHART_VALUES}: unsupported line for this reader: ${line}`);

    const indent = line.length - line.trimStart().length;
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const parent = stack[stack.length - 1]!.node;

    const [, key, rawValue] = entry;
    if (rawValue === undefined || rawValue === '') {
      const child: Record<string, YamlNode> = {};
      parent[key!] = child;
      stack.push({ indent, node: child });
      continue;
    }
    parent[key!] = rawValue
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
  }
  return root;
}

function mapAt(values: Record<string, YamlNode>, path: string): Record<string, string> {
  let node: YamlNode | undefined = values;
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === undefined) break;
    node = node[segment];
  }
  expect(typeof node, `${CHART_VALUES} has no map at ${path}`).toBe('object');
  const map = node as Record<string, YamlNode>;
  return Object.fromEntries(
    Object.entries(map).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  );
}

const values = parseSimpleYaml(read(CHART_VALUES));
const chartConfig = mapAt(values, 'config');
const chartSecrets = mapAt(values, 'secrets');
const apiApp = mapAt(values, 'apps.api');
const apiHpa = mapAt(values, 'apps.api.hpa');

describe('Helm chart storage ↔ apps/api storage code (tm 242, M-STORE · audit D6)', () => {
  it('selects a provider the code actually implements (NFR-R1)', () => {
    expect(STORAGE_PROVIDERS as readonly string[]).toContain(chartConfig.STORAGE_PROVIDER);
  });

  it('never ships pod-local uploads together with more than one api pod (NFR-R1)', () => {
    // BOTH shapes are legal and this is deliberately not a test for one of
    // them: `local` at a single replica is a correct small deployment, and a
    // shared store at four is a correct larger one. What is never correct is
    // the pair the chart used to ship — the audit's D6, reproduced in this
    // repo's own two-pod control group.
    const provider = chartConfig.STORAGE_PROVIDER!;
    const mostPods = Math.max(Number(apiApp.replicas), Number(apiHpa.maxReplicas));
    expect(Number.isFinite(mostPods)).toBe(true);
    expect(
      POD_LOCAL_PROVIDERS.has(provider) && mostPods > 1,
      `${CHART_VALUES} runs up to ${mostPods} api pods on STORAGE_PROVIDER=${provider}: ` +
        'an upload taken by one pod is a 404 from the next and a 400 on any event carrying ' +
        'its attachment_url. Either select a shared object store or cap api at one pod.',
    ).toBe(false);
  });

  it('keeps its own list of providers in step with the code (NFR-R1)', () => {
    // The stale comment was the other half of D6 and the cheaper half to fix:
    // a manifest that describes the code wrongly is a manifest nobody can use
    // to decide anything. Written in a form a machine can check so it cannot
    // go stale again in silence.
    const claim = /^\s*#\s*STORAGE_PROVIDERS:\s*(.+)$/m.exec(read(CHART_VALUES));
    expect(claim, `${CHART_VALUES} must state which providers the code has`).not.toBeNull();
    const claimed = claim![1]!.split(',').map((name) => name.trim());
    expect(claimed).toEqual([...STORAGE_PROVIDERS]);
  });

  it('supplies everything parseEnv demands for the provider it selects (NFR-R1)', () => {
    // The chart's own ConfigMap and Secret, merged the way `envFrom` merges
    // them into the container, handed to the real parser rather than to a
    // duplicated list of key names — the code moves the goalposts, the test
    // follows.
    //
    // NODE_ENV is forced to development for one reason: the chart's shipped
    // `dev-only-…` key material is *meant* to be refused under production (see
    // templates/secret.yaml), that refusal is pinned in env.test.ts, and it
    // would mask the storage question this file is asking. Storage
    // completeness is checked in every environment by `parseEnv` itself.
    const env = parseEnv({ ...chartConfig, ...chartSecrets, NODE_ENV: 'development' });

    expect(env.STORAGE_PROVIDER).toBe(chartConfig.STORAGE_PROVIDER);
    if (POD_LOCAL_PROVIDERS.has(env.STORAGE_PROVIDER)) {
      expect(env.storage.s3).toBeNull();
      return;
    }
    expect(env.storage.s3).not.toBeNull();
    expect(env.storage.s3?.endpoint).toBe(chartConfig.STORAGE_S3_ENDPOINT);
    expect(env.storage.s3?.bucket).toBe(chartConfig.STORAGE_S3_BUCKET);
    expect(env.storage.s3?.accessKeyId).toBe(chartSecrets.STORAGE_S3_ACCESS_KEY_ID);
    expect(env.storage.s3?.secretAccessKey).toBe(chartSecrets.STORAGE_S3_SECRET_ACCESS_KEY);
  });

  it('routes the bucket credential through the Secret, not the ConfigMap (NFR-S11)', () => {
    for (const key of ['STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY']) {
      expect(Object.keys(chartSecrets)).toContain(key);
      expect(Object.keys(chartConfig)).not.toContain(key);
    }
  });

  it('every key under `secrets:` actually reaches the pod (tm 164.4 trap)', () => {
    // templates/secret.yaml renders a FIXED stringData list rather than
    // ranging over `.Values.secrets` (its own comment explains why it stays
    // that way). A key added to values.yaml alone is therefore invisible — it
    // renders nothing, breaks nothing, and the process simply never sees it.
    const template = read(CHART_SECRET);
    for (const key of Object.keys(chartSecrets)) {
      if (key === 'enabled') continue;
      expect(
        template.includes(`${key}: {{ .Values.secrets.${key} | quote }}`),
        `${CHART_SECRET} does not render secrets.${key}, so no pod ever receives it`,
      ).toBe(true);
    }
  });
});

describe('Helm chart back office ↔ the compose files and apps/admin (tm 389.7)', () => {
  const CHART_TEMPLATES = 'infra/helm/siyahtus/templates';
  const platformApp = mapAt(values, 'apps.platform-api');
  const platformProbes = mapAt(values, 'apps.platform-api.probes');
  const adminApp = mapAt(values, 'apps.admin');
  const adminProbes = mapAt(values, 'apps.admin.probes');
  const networkPolicy = mapAt(values, 'networkPolicy.platformApi');

  /** A service's block in a compose file: lines indented deeper than its `name:` line. */
  function composeService(file: string, name: string): string {
    const lines = read(file).split('\n');
    const start = lines.findIndex((line) => line === `  ${name}:`);
    expect(start, `${file} has no service ${name}`).toBeGreaterThanOrEqual(0);
    const end = lines.findIndex((line, i) => i > start && /^ {0,2}\S/.test(line));
    return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
  }

  it('runs platform-api as the api image with the compose file command, past the entrypoint', () => {
    expect(platformApp.repository).toBe(apiApp.repository);
    // The same words compose passes as `command:` (the image's CMD) …
    const compose = composeService('docker-compose.pilot.yml', 'platform-api');
    const command = /command: \[(.+)\]/.exec(compose)?.[1];
    expect(command, 'docker-compose.pilot.yml gives platform-api no command').toBeDefined();
    const words = (list: string): string[] => list.split(',').map((w) => w.trim().slice(1, -1));
    const args = /^\[(.+)\]$/.exec(platformApp.args ?? '')?.[1];
    expect(words(args ?? '')).toEqual(words(command!));
    // … and rendered as `args`: a Kubernetes `command` replaces the ENTRYPOINT, which migrates
    // (or, here, deliberately skips migrating) before it runs the process.
    const deployment = read(`${CHART_TEMPLATES}/deployment.yaml`);
    expect(deployment).toContain('args: {{ toJson . }}');
    expect(deployment).not.toMatch(/^\s+command:/m);
  });

  it('listens where PLATFORM_PORT says, and probes the platform health routes', () => {
    expect(platformApp.port).toBe(chartConfig.PLATFORM_PORT);
    expect(platformApp.port).toBe('4002');
    expect(platformProbes.liveness).toBe('/platform/v1/health/live');
    expect(platformProbes.readiness).toBe('/platform/v1/health/ready');
    // The compose healthcheck probes the same route on the same port.
    expect(composeService('docker-compose.pilot.yml', 'platform-api')).toContain(
      'http://127.0.0.1:4002/platform/v1/health/ready',
    );
  });

  it('runs the admin image on its nginx port, probing the file its Dockerfile probes', () => {
    expect(adminApp.repository).toBe('siyahtus-admin');
    expect(adminApp.port).toBe('8080');
    expect(adminApp.needsSecrets).toBe('false');
    expect(adminProbes).toEqual({ liveness: '/index.html', readiness: '/index.html' });
    const dockerfile = read('apps/admin/Dockerfile');
    expect(dockerfile).toContain('EXPOSE 8080');
    expect(dockerfile).toContain('http://127.0.0.1:8080/index.html');
  });

  it('tells the admin nginx where platform-api is, from the ConfigMap, by the release name', () => {
    const configmap = read(`${CHART_TEMPLATES}/configmap.yaml`);
    expect(configmap).toContain(
      'PLATFORM_UPSTREAM: http://{{ .Release.Name }}-platform-api:{{ (index .Values.apps "platform-api").port }}',
    );
    // apps/admin/nginx.conf reads exactly that variable.
    expect(read('apps/admin/nginx.conf')).toContain('${PLATFORM_UPSTREAM}');
  });

  it('hands the BYPASSRLS role to the platform-api pod alone', () => {
    // The shared Secret reaches api, rtm and the migration Job whole; the platform role
    // gets a Secret of its own, and only `needsPlatformSecrets` apps mount it.
    const [shared, own] = read(CHART_SECRET).split(/^---$/m);
    expect(shared).toContain('name: {{ .Release.Name }}-secrets');
    expect(shared).not.toContain('DATABASE_PLATFORM_URL');
    expect(own).toContain('name: {{ .Release.Name }}-platform-secrets');
    expect(own).toContain(
      'DATABASE_PLATFORM_URL: {{ .Values.secrets.DATABASE_PLATFORM_URL | quote }}',
    );
    expect(read(`${CHART_TEMPLATES}/deployment.yaml`)).toContain(
      'if $app.needsPlatformSecrets }}\n            # The BYPASSRLS role',
    );
    const apps = (values['apps'] ?? {}) as Record<string, Record<string, YamlNode>>;
    const mounting = Object.entries(apps)
      .filter(([, app]) => app['needsPlatformSecrets'] === 'true')
      .map(([name]) => name);
    expect(mounting).toEqual(['platform-api']);
    // compose keeps the same rule: the tenant services are not given the role.
    for (const service of ['api', 'rtm']) {
      expect(composeService('docker-compose.pilot.yml', service)).not.toContain(
        'DATABASE_PLATFORM_URL',
      );
    }
  });

  it('lets an app be switched off in every ranged template, without `| default true`', () => {
    for (const file of ['deployment', 'service', 'hpa', 'pdb']) {
      expect(read(`${CHART_TEMPLATES}/${file}.yaml`), file).toContain('(hasKey $app "enabled")');
    }
    for (const app of [platformApp, adminApp]) expect(app.enabled).toBe('true');
    for (const name of ['api', 'rtm', 'web', 'widget']) {
      expect(Object.keys(mapAt(values, `apps.${name}`)), name).not.toContain('enabled');
    }
  });

  it('admits platform-api from the admin pods only, and bounds what it may dial', () => {
    const policy = read(`${CHART_TEMPLATES}/networkpolicy.yaml`);
    const own = policy.slice(policy.indexOf('name: {{ .Release.Name }}-platform-api'));
    expect(own).toContain('app.kubernetes.io/name: platform-api');
    // One unconditional ingress peer — the admin pods — on platform-api's own port.
    expect(own).toMatch(
      /- from:\n\s+- podSelector:\n\s+matchLabels:\n\s+app\.kubernetes\.io\/name: admin\n/,
    );
    expect(own).toContain('port: {{ $platformApi.port }}');
    expect(own).toMatch(
      /policyTypes:\n\s+- Ingress\n\s+\{\{- if [^}]+egress\.enabled \}\}\n\s+- Egress/,
    );
    // Databases by port: Postgres and Redis, and DNS.
    expect(own).toContain('range .Values.networkPolicy.platformApi.egress.datastorePorts');
    expect(networkPolicy.extraIngressFrom).toBe('[]');
    expect(mapAt(values, 'networkPolicy.platformApi.egress').datastorePorts).toBe('[5432, 6379]');
  });

  it('ships the production overlay with a placeholder the operator must fill, never a working URL', () => {
    const overlay = read('infra/helm/siyahtus/values.production.example.yaml');
    expect(overlay).toContain(
      'DATABASE_PLATFORM_URL: "postgresql://siyahtus_platform:<platform_password>@<db-host>:5432/<db>"',
    );
    expect(overlay).toContain('ADMIN_APP_URL: "https://admin.<your-domain>"');
  });
});
