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
import { SUMMARY_TREND_STATS } from './thresholds.js';

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

/** The stdout block. Short on purpose; the JSON is the record. */
function renderText(report) {
  const lines = [
    '',
    `  nexa load — ${report.scenario}`,
    `  target ${report.target.api}`,
    `  profile ${report.profile.vus} VU · ramp ${report.profile.ramp_up} · plateau ${report.profile.duration} · pacing ${report.profile.pacing_seconds}s`,
    report.note ? `  note ${report.note}` : null,
    '',
  ].filter((line) => line !== null);

  for (const [name, values] of Object.entries(report.metrics)) {
    if (values.type !== 'trend') continue;
    lines.push(
      `  ${name.padEnd(44)} p99 ${formatMs(values['p(99)'])}  med ${formatMs(values.med)}  n=${values.count ?? 0}`,
    );
  }

  lines.push('');
  for (const result of report.thresholds) {
    lines.push(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.metric} ${result.expression}`);
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
 * @param {string} scenario file-name stem, e.g. `'smoke'`
 */
export function summaryHandler(scenario) {
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
      },
      trend_stats: SUMMARY_TREND_STATS,
      passed: thresholds.every((result) => result.ok),
      thresholds,
      metrics: metricValues(data.metrics),
    };

    return {
      stdout: renderText(report),
      [`${CONFIG.resultsDir}/${scenario}.json`]: `${JSON.stringify(report, null, 2)}\n`,
    };
  };
}
