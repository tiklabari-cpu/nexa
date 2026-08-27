/**
 * The guard that makes the load suite a measurement rather than a claim.
 *
 * §D122's lesson, applied: a threshold is only evidence for an NFR if it is
 * still the NFR's number. Numbers get copied once and then drift — the PRD is
 * revised, or a red run gets "fixed" by relaxing the budget it crossed — and
 * nothing notices, because a passing load run looks identical either way.
 *
 * So this file does not restate the budgets. It re-reads §7.1 and §7.4 of the
 * PRD on every run and fails when `lib/thresholds.js` and the PRD disagree in
 * EITHER direction: a loosened threshold and a tightened requirement are both
 * defects, and only one of them is obvious.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUDGET_PROOFS,
  METRIC_NAMES,
  NFR_BUDGETS,
  OP_TAGS,
  restThresholds,
  rtmThresholds,
  sharedThresholds,
  SUMMARY_TREND_STATS,
} from '../lib/thresholds.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packageRoot = join(here, '..');

const prdLines = readFileSync(join(repoRoot, 'urun-gereksinim-dokumani-PRD.md'), 'utf8').split(
  /\r?\n/,
);

/**
 * The one table row for a requirement.
 *
 * Uniqueness is asserted, not assumed: if the PRD ever grows a second `NFR-P2`
 * row, silently reading the first would make this guard agree with whichever
 * copy happened to come first in the file.
 */
function requirementRow(id: string): string {
  const rows = prdLines.filter((line) => line.startsWith(`| ${id} |`));
  expect(rows, `expected exactly one PRD row for ${id}`).toHaveLength(1);
  return rows[0]!;
}

/** Every `<n> ms` in a row, in order. */
function millisecondsIn(row: string): number[] {
  return [...row.matchAll(/(\d+)\s*ms/g)].map((match) => Number(match[1]));
}

/** A `%99.95`-style ratio from a row, as a fraction. */
function percentIn(row: string): number {
  const match = /%(\d+(?:\.\d+)?)/.exec(row);
  expect(match, `no percentage in: ${row}`).not.toBeNull();
  // Rounded, because 99.9 / 100 is 0.9990000000000001 in binary floating point
  // and the budget file spells the literal 0.999.
  return Number((Number(match![1]) / 100).toFixed(6));
}

/** Flatten a threshold map to the `metric expression` strings k6 will evaluate. */
function expressions(thresholds: Record<string, string[]>): string[] {
  return Object.entries(thresholds).flatMap(([metric, list]) =>
    list.map((expression) => `${metric} ${expression}`),
  );
}

describe('the budgets come from the PRD, not from this repo', () => {
  it('NFR-P2 — REST read and write p99 match §7.1', () => {
    const row = requirementRow('NFR-P2');
    // Labelled rather than positional: the row says "300 ms yazma / 150 ms
    // okuma", and reading them by position would survive the two being swapped
    // — which would quietly give writes the read budget and pass.
    const labelled = [...row.matchAll(/(\d+)\s*ms\s*(yazma|okuma)/g)].map((match) => ({
      ms: Number(match[1]),
      kind: match[2],
    }));

    expect(labelled).toEqual([
      { ms: NFR_BUDGETS.restWriteP99Ms, kind: 'yazma' },
      { ms: NFR_BUDGETS.restReadP99Ms, kind: 'okuma' },
    ]);
  });

  it('NFR-P1 — RTM fan-out p99 matches §7.1', () => {
    expect(millisecondsIn(requirementRow('NFR-P1'))).toEqual([NFR_BUDGETS.rtmFanoutP99Ms]);
  });

  it('NFR-U3 restates NFR-P1, and the two still agree', () => {
    // Two tables, one number. If §7.4 is revised and §7.1 is not, a suite that
    // reads only one of them would keep passing against a budget the product no
    // longer promises.
    expect(millisecondsIn(requirementRow('NFR-U3'))).toEqual([NFR_BUDGETS.rtmFanoutP99Ms]);
  });

  it('NFR-P8 — the per-pod connection target matches §7.1', () => {
    const row = requirementRow('NFR-P8');
    const thousands = /(\d+)k\b/.exec(row);
    expect(thousands, `no "<n>k" connection target in: ${row}`).not.toBeNull();
    expect(Number(thousands![1]) * 1000).toBe(NFR_BUDGETS.rtmConnectionsPerPod);
  });

  it('NFR-U1 / NFR-U2 — the availability floors match §7.4', () => {
    expect(percentIn(requirementRow('NFR-U1'))).toBe(NFR_BUDGETS.rtmLoginSuccessRatio);
    expect(percentIn(requirementRow('NFR-U2'))).toBe(NFR_BUDGETS.apiSuccessRatio);
  });
});

describe('the thresholds are built from those budgets', () => {
  it('REST thresholds carry the read and write p99 separately', () => {
    expect(expressions(restThresholds())).toEqual(
      expect.arrayContaining([
        `http_req_duration{op:${OP_TAGS.read}} p(99)<${NFR_BUDGETS.restReadP99Ms}`,
        `http_req_duration{op:${OP_TAGS.write}} p(99)<${NFR_BUDGETS.restWriteP99Ms}`,
      ]),
    );
  });

  it('RTM thresholds carry fan-out latency and login success', () => {
    expect(expressions(rtmThresholds())).toEqual(
      expect.arrayContaining([
        `${METRIC_NAMES.fanoutLatency} p(99)<${NFR_BUDGETS.rtmFanoutP99Ms}`,
        `${METRIC_NAMES.rtmLoginSuccess} rate>=${NFR_BUDGETS.rtmLoginSuccessRatio}`,
      ]),
    );
  });

  it('every scenario inherits the 429 guard and the availability floor', () => {
    const shared = expressions(sharedThresholds());
    expect(shared).toContain(`${METRIC_NAMES.rateLimited} count==0`);
    expect(shared).toContain('checks rate==1.00');
    // 99.95% available ⇒ fewer than 0.05% of requests may fail.
    expect(shared).toContain('http_req_failed rate<0.0005');
    for (const builder of [restThresholds, rtmThresholds]) {
      expect(expressions(builder())).toEqual(expect.arrayContaining(shared));
    }
  });

  it('no latency budget can pass without samples', () => {
    // Measured on the first green smoke run: k6 reported
    // `http_req_duration{op:write} p(99)<300` as PASS while the scenario sent
    // zero writes. An empty metric satisfies every percentile expression, so a
    // budget nothing exercised looks exactly like a budget that was met — the
    // one outcome this suite exists to make impossible. `count>0` cannot go on
    // the trend itself (k6: "unsupported aggregation method count on metric of
    // type trend"), so each budget names a counter that proves it ran.
    const all: Record<string, string[]> = { ...restThresholds(), ...rtmThresholds() };
    for (const [metric, list] of Object.entries(all)) {
      if (!list.some((expression) => expression.includes('p(99)'))) continue;

      const op = (BUDGET_PROOFS as Record<string, string>)[metric];
      expect(op, `${metric} has a p99 budget but no entry in BUDGET_PROOFS`).toBeDefined();
      expect(all[`${METRIC_NAMES.measured}{op:${op}}`], `${metric} has no proof it ran`).toEqual([
        'count>0',
      ]);
    }
  });

  it('lets a scenario decline a budget it does not drive', () => {
    const readOnly = Object.keys(restThresholds({ write: false }));
    expect(readOnly).toContain(`http_req_duration{op:${OP_TAGS.read}}`);
    expect(readOnly).toContain(`${METRIC_NAMES.measured}{op:${OP_TAGS.read}}`);
    expect(readOnly).not.toContain(`http_req_duration{op:${OP_TAGS.write}}`);
    expect(readOnly).not.toContain(`${METRIC_NAMES.measured}{op:${OP_TAGS.write}}`);
  });

  it('keeps p(99) in the summary, because every budget is a p99', () => {
    // k6's default trend stats stop at p(95). Without this the run would be
    // judged on a percentile the summary does not contain, and 161.4 would have
    // no number to write into PLAN §7.2.
    expect(SUMMARY_TREND_STATS).toContain('p(99)');
    const p99Thresholds = [
      ...expressions(restThresholds()),
      ...expressions(rtmThresholds()),
    ].filter((expression) => expression.includes('p(99)'));
    expect(p99Thresholds.length).toBeGreaterThan(0);
  });
});

describe('the two halves of the metric vocabulary stay in step', () => {
  const metricsSource = readFileSync(join(packageRoot, 'lib', 'metrics.js'), 'utf8');

  it('metrics.js declares every name the thresholds reference', () => {
    for (const [key, name] of Object.entries(METRIC_NAMES)) {
      expect(metricsSource, `metrics.js does not declare ${key} (${name})`).toContain(
        `METRIC_NAMES.${key}`,
      );
    }
  });

  it('no custom metric name is spelled as a literal outside the table', () => {
    // A literal would be the drift: k6 takes threshold keys as strings, so a
    // typo'd name creates a threshold on a metric that never receives a sample
    // — which k6 reports as passing.
    for (const name of Object.values(METRIC_NAMES)) {
      expect(metricsSource).not.toContain(`'${name}'`);
    }
  });
});

describe('every request is tagged and counted by the same call', () => {
  it('nothing but lib/http.js imports k6/http', () => {
    // The `op` tag picks the latency budget; `nexa_measured{op:…}` proves the
    // budget was driven. Set from two call sites they drift, and both drift
    // directions are silent: a tagged sample with no counter reads as
    // unexercised, a counter with no tagged sample reads as met.
    const sources = [
      ...readdirSync(join(packageRoot, 'lib')).map((name) => join('lib', name)),
      ...readdirSync(join(packageRoot, 'scenarios')).map((name) => join('scenarios', name)),
    ].filter((path) => path.endsWith('.js') && path !== join('lib', 'http.js'));

    expect(sources.length).toBeGreaterThan(1);
    for (const path of sources) {
      const source = readFileSync(join(packageRoot, path), 'utf8');
      expect(source, `${path} reaches for k6/http directly — use lib/http.js`).not.toMatch(
        /from 'k6\/http'/,
      );
    }
  });
});

describe('a scenario cannot quietly opt out of the gate', () => {
  // 161.2 adds `rest`, 161.3 adds `rtm`. Extending this list is how each of
  // them signs up for the same guard.
  const scenarioNames = ['smoke', 'rest'];

  for (const scenario of scenarioNames) {
    it(`${scenario}.js sets its thresholds and trend stats from the shared modules`, () => {
      const source = readFileSync(join(packageRoot, 'scenarios', `${scenario}.js`), 'utf8');
      expect(source).toMatch(/thresholds:\s*(rest|rtm|shared)Thresholds\(/);
      expect(source).toContain('summaryTrendStats: SUMMARY_TREND_STATS');
      // The results file is what 161.4 reads; a scenario that only prints is a
      // scenario whose numbers cannot be re-checked.
      expect(source).toContain('summaryHandler(');
    });
  }
});
