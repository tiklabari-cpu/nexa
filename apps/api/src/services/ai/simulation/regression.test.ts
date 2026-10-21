/**
 * The regression report (tm 314.3 · SiyahTuş analysis AI-19 §5 and its
 * acceptance "Regresyon ekranı 'geçiyordu → kalıyor' senaryolarını en üstte
 * gösterir"): how a result compares with the same scenario's earlier one, and
 * the order the results are listed in.
 */
import { describe, expect, it } from 'vitest';
import { orderResults, regressionOf, regressions, type ComparedResult } from './regression.js';

const result = (
  scenarioKey: string,
  status: string,
  outcome: string | null = 'handoff',
  handoffTeamId: bigint | null = 4n,
): ComparedResult => ({ scenarioKey, status, outcome, handoffTeamId });

describe('how a result compares with its earlier one (AI-19 §5)', () => {
  it.each([
    ['passed → failed', result('a', 'passed'), result('a', 'failed'), 'newly_failing'],
    [
      'passed → errored',
      result('a', 'passed'),
      result('a', 'errored', null, null),
      'newly_failing',
    ],
    [
      'failed → failed, resolved instead of handed over',
      result('a', 'failed'),
      result('a', 'failed', 'resolved', null),
      'outcome_changed',
    ],
    [
      'passed → passed, resolved instead of handed over',
      result('a', 'passed'),
      result('a', 'passed', 'resolved', null),
      'outcome_changed',
    ],
    ['another team', result('a', 'passed'), result('a', 'passed', 'handoff', 9n), 'team_changed'],
    [
      'routing decides now',
      result('a', 'failed'),
      result('a', 'failed', 'handoff', null),
      'team_changed',
    ],
    ['failed → passed', result('a', 'failed'), result('a', 'passed'), 'newly_passing'],
    [
      'errored → passed',
      result('a', 'errored', null, null),
      result('a', 'passed'),
      'newly_passing',
    ],
    ['unchanged pass', result('a', 'passed'), result('a', 'passed'), null],
    ['unchanged fail', result('a', 'failed'), result('a', 'failed'), null],
  ] as const)('%s', (_name, previous, current, expected) => {
    expect(regressionOf(current, previous)).toBe(expected);
  });

  it('newly failing outranks a changed outcome', () => {
    expect(regressionOf(result('a', 'failed', 'resolved'), result('a', 'passed'))).toBe(
      'newly_failing',
    );
  });

  it('a failed result that ended another way is a changed outcome before it is newly passing', () => {
    expect(regressionOf(result('a', 'passed', 'resolved', null), result('a', 'failed'))).toBe(
      'outcome_changed',
    );
  });

  it('an errored result is not compared for outcome or team: where it stopped is no ending', () => {
    expect(
      regressionOf(result('a', 'errored', null, null), result('a', 'errored', 'handoff', 4n)),
    ).toBeNull();
    expect(
      regressionOf(result('a', 'failed', null, null), result('a', 'errored', null, null)),
    ).toBe(null);
  });

  it('a team id read as a bigint and as a number is the same team', () => {
    expect(
      regressionOf(
        { scenarioKey: 'a', status: 'passed', outcome: 'handoff', handoffTeamId: 4 },
        result('a', 'passed', 'handoff', 4n),
      ),
    ).toBeNull();
  });

  it('nothing to compare with — a new scenario, or no earlier run — is null', () => {
    expect(regressionOf(result('a', 'failed'), undefined)).toBeNull();
    const current = [result('a', 'failed'), result('compliance:G3:tr', 'failed')];
    const map = regressions(current, [result('compliance:G3:tr', 'passed')]);
    expect(map.get(current[0]!)).toBeNull();
    expect(map.get(current[1]!)).toBe('newly_failing');
  });
});

describe('the order the report lists them in', () => {
  it('newly failing first, then changed outcome or team, then failed, errored, passed in play order', () => {
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7'];
    const earlier = [
      result('s1', 'failed'),
      result('s2', 'passed'),
      result('s3', 'passed'),
      result('s4', 'passed'),
      result('s5', 'failed'),
      result('s7', 'passed'),
    ];
    const current = [
      result('s1', 'passed'), // newly passing
      result('s2', 'passed', 'handoff', 9n), // team changed
      result('s3', 'passed'), // unchanged
      result('s4', 'failed'), // newly failing
      result('s5', 'failed'), // unchanged failure
      result('s6', 'errored', null, null), // new scenario
      result('s7', 'errored', null, null), // newly failing (errored)
      result('compliance:G1:tr', 'passed'), // not among the ids
    ];
    const map = regressions(current, earlier);
    expect(orderResults(current, map, ids).map((r) => r.scenarioKey)).toEqual([
      's4',
      's7',
      's2',
      's5',
      's6',
      's1',
      's3',
      'compliance:G1:tr',
    ]);
  });

  it('without an earlier run: failed, errored, passed — each in play order', () => {
    const current = [
      result('b', 'passed'),
      result('a', 'errored', null, null),
      result('c', 'failed'),
    ];
    const order = orderResults(current, regressions(current, []), ['b', 'c', 'a']);
    expect(order.map((r) => r.scenarioKey)).toEqual(['c', 'a', 'b']);
  });
});
