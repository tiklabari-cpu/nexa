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
  markerText,
  markerTimestamp,
  RTM_AGENT_PATH,
  RTM_FANOUT_PUSH,
  RTM_PING_INTERVAL_MS,
  RTM_PROTOCOL_VERSION,
} from '../lib/protocol.js';
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
  // Extending this list is how a new scenario signs up for the same guard.
  const scenarioNames = ['smoke', 'rest', 'rtm'];

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

describe('"degraded" is defined before the pod is measured (NFR-P8)', () => {
  // NFR-P8 is not a budget met or crossed; it is a number found by ramping
  // connections until the pod stops coping. Which makes "stops coping" the
  // whole measurement: written after the fact it is whatever the operator felt
  // like calling a limit. These are the three aggregate readings, as gates.
  const rtm = rtmThresholds();

  it('a fan-out outside NFR-P1 fails the run', () => {
    expect(rtm[METRIC_NAMES.fanoutLatency]).toEqual([`p(99)<${NFR_BUDGETS.rtmFanoutP99Ms}`]);
  });

  it('a connection that could not be established fails the run', () => {
    expect(rtm[METRIC_NAMES.rtmConnectFailed]).toEqual(['count==0']);
  });

  it('a live connection that was lost fails the run', () => {
    expect(rtm[METRIC_NAMES.rtmSocketDropped]).toEqual(['count==0']);
  });

  it('claims the reconnect guarantee only when the run drives it', () => {
    // A k6 `Rate` with no samples reads as 0, so an unconditional `rate==1.00`
    // would fail every run configured with `LOAD_RTM_RECONNECT_EVERY=0` — a
    // red that says nothing about the product.
    expect(rtm[METRIC_NAMES.rtmSyncRecovered]).toBeUndefined();
    expect(rtmThresholds({ reconnect: true })[METRIC_NAMES.rtmSyncRecovered]).toEqual([
      'rate==1.00',
    ]);
  });
});

describe('the scenario speaks the protocol the gateway implements', () => {
  // `lib/protocol.js` restates four facts that live in the product's own
  // source, because k6 cannot import TypeScript. Restated constants drift, and
  // every one of these drifts *quietly*: a stale version makes the gateway
  // answer `unsupported_version` on a frame while the socket stays open, a
  // stale path makes the handshake 400, a stale push name makes a subscription
  // that receives nothing. All three produce a run that finishes and writes a
  // results file — which is the failure this suite exists to refuse.
  const rtmSource = readFileSync(join(repoRoot, 'packages', 'types', 'src', 'rtm.ts'), 'utf8');

  /** A `name: 'value'` or `name = 'value'` string constant from that file. */
  function stringConstant(name: string): string {
    const match = new RegExp(`${name}\\s*[:=]\\s*'([^']+)'`).exec(rtmSource);
    expect(match, `no ${name} in packages/types/src/rtm.ts`).not.toBeNull();
    return match![1]!;
  }

  /** A numeric constant, with TypeScript's `_` digit separators removed. */
  function numberConstant(name: string): number {
    const match = new RegExp(`${name}\\s*:\\s*([\\d_]+)`).exec(rtmSource);
    expect(match, `no ${name} in packages/types/src/rtm.ts`).not.toBeNull();
    return Number(match![1]!.replaceAll('_', ''));
  }

  it("uses the gateway's envelope version", () => {
    expect(RTM_PROTOCOL_VERSION).toBe(stringConstant('RTM_VERSION'));
  });

  it('dials the agent socket at the path the gateway serves', () => {
    expect(RTM_AGENT_PATH).toBe(stringConstant('agent'));
  });

  it('subscribes to a push the gateway can actually send', () => {
    const block = /RTM_PUSH_ACTIONS = \[([\s\S]*?)\] as const/.exec(rtmSource);
    expect(block, 'no RTM_PUSH_ACTIONS array in packages/types/src/rtm.ts').not.toBeNull();
    expect(block![1]).toContain(`'${RTM_FANOUT_PUSH}'`);
  });

  it('pings well inside the window the gateway drops an idle socket in', () => {
    // The load-bearing one. The gateway closes a socket that has sent nothing
    // for `idleTimeoutMs`, and only *client frames* move that clock — the
    // transport's own ping/pong does not. Narrow this margin and every socket
    // in a capacity run starts dropping mid-plateau, which reads exactly like
    // the pod's connection limit and is not.
    expect(RTM_PING_INTERVAL_MS * 2).toBeLessThan(numberConstant('idleTimeoutMs'));
  });
});

describe("a fan-out sample is only ever taken from this suite's own message", () => {
  it('carries the publish instant through the message text', () => {
    const sentAt = 1_787_000_000_123;
    expect(markerTimestamp(markerText(sentAt, 7, 3))).toBe(sentAt);
  });

  it('refuses to read a timestamp out of anything else', () => {
    // The subscriber cannot tell whose event it just received. Without this,
    // an event from a colleague clicking around the seeded workspace — or from
    // `rest.js` running at the same time — would be timed against a number
    // that is not a publish instant, and the resulting NFR-P1 sample would be
    // wrong in a way no threshold could notice.
    for (const text of [
      'Do you ship to France?',
      'load rest.js — VU 1 iter 2',
      'load rtm.js — no timestamp here',
      '',
      undefined,
      null,
      42,
    ]) {
      expect(markerTimestamp(text), `read a timestamp out of ${JSON.stringify(text)}`).toBeNull();
    }
  });

  it('never writes a message the product will mask on the way in', () => {
    // Not hypothetical — measured. `POST /chats/:id/events` masks card numbers
    // before persisting (`apps/api/src/lib/cc-mask.ts`): a 13–19 digit run that
    // passes Luhn becomes `**** **** **** 1234`. An epoch-ms timestamp is
    // exactly 13 digits and a mod-10 checksum passes one time in ten, so the
    // first version of this marker had 10% of its messages come back unreadable
    // — the push still arrived, the timestamp did not, and the fan-out sample
    // vanished with no threshold able to see it.
    //
    // The detector's own pattern is re-read here rather than restated, so
    // widening it (a new separator, a shorter minimum) fails this test instead
    // of quietly costing the next capacity run its samples.
    const maskSource = readFileSync(
      join(repoRoot, 'apps', 'api', 'src', 'lib', 'cc-mask.ts'),
      'utf8',
    );
    const pattern = /const CARD_CANDIDATE = \/(.+)\/g;/.exec(maskSource);
    expect(pattern, 'no CARD_CANDIDATE regex in apps/api/src/lib/cc-mask.ts').not.toBeNull();
    const candidate = new RegExp(pattern![1]!, 'g');

    // A spread rather than one sample: the failure was data-dependent, and one
    // lucky timestamp is exactly how it stayed hidden the first time.
    for (let ms = 1_787_856_000_000; ms < 1_787_856_000_000 + 5_000; ms += 1) {
      const text = markerText(ms, 12, 34);
      candidate.lastIndex = 0;
      expect(candidate.test(text), `${text} is a card-number candidate`).toBe(false);
    }
  });
});
