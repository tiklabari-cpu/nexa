/**
 * Where `scripts/csp-smoke.sh` publishes the built images (tm 434), shared by
 * `playwright.csp.config.ts` (Chromium's resolver rules) and
 * `csp-smoke.spec.ts` (its calls from Node, which do not see those rules).
 *
 * The bundles were built for the usual addresses — the panel's RTM URL and
 * the widget's API base are baked in — so the browser keeps using
 * `localhost:4000/4001/5173/5174` and the resolver maps each onto these.
 * Same defaults as `scripts/csp-smoke.compose.yml`, same variables.
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a port number, not ${raw}`);
  }
  return value;
}

export const CSP_SMOKE_PORTS = {
  api: port('CSP_SMOKE_API_PORT', 14_000),
  rtm: port('CSP_SMOKE_RTM_PORT', 14_001),
  web: port('CSP_SMOKE_WEB_PORT', 15_173),
  widget: port('CSP_SMOKE_WIDGET_PORT', 15_174),
} as const;

/** The usual address → the published port, as Chromium's `--host-resolver-rules` takes it. */
export const CSP_SMOKE_RESOLVER_RULES = [
  `MAP localhost:4000 localhost:${CSP_SMOKE_PORTS.api}`,
  `MAP localhost:4001 localhost:${CSP_SMOKE_PORTS.rtm}`,
  `MAP localhost:5173 localhost:${CSP_SMOKE_PORTS.web}`,
  `MAP localhost:5174 localhost:${CSP_SMOKE_PORTS.widget}`,
].join(', ');
