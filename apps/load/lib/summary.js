/**
 * What a run leaves behind.
 *
 * Two outputs, on purpose:
 *
 *   - stdout, so the operator sees whether the gate passed without opening a file;
 *   - `results/<scenario>.json`, machine-readable, because 161.4 has to copy
 *     measured numbers into PLAN §7.2 and a number scraped from a terminal is a
 *     number nobody can re-check.
 *
 * The JSON carries the run *conditions* alongside the numbers — profile, target,
 * k6 version, and a free-text `LOAD_NOTE` for the hardware. A latency figure
 * without the machine it was measured on is not a measurement, it is a rumour,
 * and §D122's whole lesson is that undocumented claims outlive their evidence.
 */
import { CONFIG } from './config.js';
import { METRIC_NAMES, SUMMARY_TREND_STATS } from './thresholds.js';

/** Every threshold k6 evaluated, flattened out of the per-metric nesting. */
function thresholdResults(metrics) {
  const results = [];
  for (const [metric, entry] of Object.entries(metrics)) {
    for (const [expression, outcome] of Object.entries(entry.thresholds ?? {})) {
      results.push({ metric, expression, ok: outcome.ok === true });
    }
  }
  return results.sort((a, b) =>
    `${a.metric}${a.expression}`.localeCompare(`${b.metric}${b.expression}`),
  );
}

/** Metric values, with the empty ones dropped — a metric with no samples says nothing. */
function metricValues(metrics) {
  const out = {};
  for (const [name, entry] of Object.entries(metrics)) {
    const values = entry.values ?? {};
    const count = values.count ?? values.passes ?? 0;
    if (count === 0 && values.rate === undefined) continue;
    out[name] = { type: entry.type, ...values };
  }
  return out;
}

function formatMs(value) {
  return typeof value === 'number' ? `${value.toFixed(1)} ms` : '—';
}

function formatCount(value) {
  return typeof value === 'number' ? String(Math.round(value)) : '—';
}

/**
 * Trends that are not durations, named rather than guessed at.
 *
 * Every trend k6 makes for itself is a time, and so is every one this suite
 * adds — except this: `nexa_rtm_connections_observed` counts sockets. Printing
 * "5000.0 ms" beside the one number NFR-P8 is about would be a lie told by the
 * formatter, and the reader has no way to catch it.
 */
const COUNT_TRENDS = new Set([METRIC_NAMES.rtmConnectionsObserved]);

function isDuration(name) {
  return !COUNT_TRENDS.has(name);
}

/**
 * Every check k6 evaluated, with its failures — flattened out of the group
 * tree, defensively, because the shape of `root_group` is k6's business and a
 * summary that throws is worse than one that is missing a section.
 *
 * Worth the care: a socket that stays open and quietly stops *receiving* is a
 * degradation no aggregate threshold can see, so `rtm.js` catches it with a
 * per-socket check. `checks rate==1.00` then fails the run — but without the
 * name of the check that failed, the operator is told only that something did.
 */
function checkResults(group) {
  if (!group || typeof group !== 'object') return [];
  const own = Object.values(group.checks ?? {}).map((check) => ({
    name: check.name,
    passes: check.passes ?? 0,
    fails: check.fails ?? 0,
  }));
  const nested = (group.groups ?? []).flatMap((child) => checkResults(child));
  return [...own, ...nested];
}

/** The stdout block. Short on purpose; the JSON is the record. */
function renderText(report) {
  const rungLine =
    report.profile.rtm_connections === undefined
      ? null
      : `  rung ${report.profile.rtm_connections} sockets · ${report.profile.rtm_vus} VU × ${report.profile.rtm_sockets_per_vu} · opened at ${report.profile.rtm_connect_rate_per_second}/s · held ${report.profile.rtm_hold_seconds}s · ${report.profile.rtm_publishes} publishes · ${report.profile.rtm_reconnecting_sockets} reconnecting`;

  const lines = [
    '',
    `  nexa load — ${report.scenario}`,
    `  target ${report.target.api}`,
    // The generic profile describes the ramping REST scenarios; a capacity rung
    // has its own shape and prints it instead, because "2 VU · plateau 30s" is
    // actively misleading next to a number about 5000 sockets.
    rungLine ??
      `  profile ${report.profile.vus} VU · ramp ${report.profile.ramp_up} · plateau ${report.profile.duration} · pacing ${report.profile.pacing_seconds}s`,
    report.note ? `  note ${report.note}` : null,
    '',
  ].filter((line) => line !== null);

  for (const [name, values] of Object.entries(report.metrics)) {
    if (values.type !== 'trend') continue;
    const format = isDuration(name) ? formatMs : formatCount;
    lines.push(
      `  ${name.padEnd(44)} p99 ${format(values['p(99)'])}  med ${format(values.med)}  max ${format(values.max)}  n=${values.count ?? 0}`,
    );
  }

  // The suite's own counters and rates. Not decoration: on a capacity run these
  // are what say *which* kind of degradation was hit — a refused connection, a
  // lost one, or neither — and how many sockets the pod said it was holding
  // while the numbers above were being taken.
  for (const [name, values] of Object.entries(report.metrics)) {
    if (!name.startsWith('nexa_') || values.type === 'trend') continue;
    const value = values.count ?? values.rate;
    if (value === undefined) continue;
    lines.push(`  ${name.padEnd(44)} ${values.type === 'rate' ? 'rate' : 'count'} ${value}`);
  }

  lines.push('');
  for (const result of report.thresholds) {
    lines.push(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.metric} ${result.expression}`);
  }
  for (const check of report.checks) {
    if (check.fails === 0) continue;
    lines.push(`  FAIL  check "${check.name}" — ${check.fails} of ${check.fails + check.passes}`);
  }
  lines.push('');
  lines.push(
    report.passed
      ? '  every threshold held — the NFR budgets in lib/thresholds.js were met under this profile'
      : '  a threshold was crossed — k6 exits non-zero, and this run is NOT evidence of the budget',
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * Build a `handleSummary` for a scenario.
 *
 * @param {string} scenario what the run is, e.g. `'rtm'`
 * @param {{ fileStem?: string, profile?: object }} [options] `fileStem`
 *   separates the results file's name from the scenario's, which the capacity
 *   ladder needs: every rung is the `rtm` scenario, and writing them all to
 *   `rtm.json` would leave only the last one. `profile` carries the knobs that
 *   are specific to one scenario — a fan-out number without the connection
 *   count it was measured at says nothing.
 */
export function summaryHandler(scenario, options = {}) {
  const fileStem = options.fileStem ?? scenario;
  const extraProfile = options.profile ?? {};

  return function handleSummary(data) {
    const thresholds = thresholdResults(data.metrics);
    const report = {
      scenario,
      generated_at: new Date().toISOString(),
      // k6 does not put its own version in the summary payload. `make load`
      // passes it in; a hand-run `k6 run` leaves it null rather than guessing.
      k6_version: __ENV['K6_VERSION'] ?? null,
      note: __ENV['LOAD_NOTE'] ?? null,
      target: { api: CONFIG.apiBaseUrl, rtm: CONFIG.rtmUrl },
      profile: {
        vus: CONFIG.vus,
        duration: CONFIG.duration,
        ramp_up: CONFIG.rampUp,
        ramp_down: CONFIG.rampDown,
        pacing_seconds: CONFIG.pacingSeconds,
        run_duration_ms: data.state?.testRunDurationMs ?? null,
        ...extraProfile,
      },
      trend_stats: SUMMARY_TREND_STATS,
      passed: thresholds.every((result) => result.ok),
      thresholds,
      checks: checkResults(data.root_group),
      metrics: metricValues(data.metrics),
    };

    return {
      stdout: renderText(report),
      [`${CONFIG.resultsDir}/${fileStem}.json`]: `${JSON.stringify(report, null, 2)}\n`,
    };
  };
}
