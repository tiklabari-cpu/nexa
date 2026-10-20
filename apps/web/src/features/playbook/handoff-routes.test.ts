/**
 * The hand-over routes screen's pure half (tm 307.3 · AI-12): the keys a route
 * can match, the draft's problems and the bodies it sends.
 */
import { HANDOFF_REASONS, QUEUE_TOPIC_ROLES, isHandoffRouteKey } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { hasMessage } from '../../lib/i18n.js';
import { ApiClientError } from '../../lib/api-client.js';
import {
  BLANK_ROUTE_DRAFT,
  createBody,
  draftOfRoute,
  routeDraftProblems,
  routeErrorKey,
  routeKeyLabelKey,
  routeKeys,
  updateBody,
  type HandoffRoute,
} from './handoff-routes.js';

const ROUTE: HandoffRoute = {
  id: 'r1',
  brand_id: null,
  match_type: 'topic',
  match_key: 'finance',
  group_id: 4,
  required_expertise_id: null,
  default_priority: 'normal',
  active: true,
};

describe('routeKeys', () => {
  it('offers exactly the keys the server takes, per type', () => {
    for (const key of routeKeys('topic')) expect(isHandoffRouteKey('topic', key)).toBe(true);
    for (const key of routeKeys('reason')) expect(isHandoffRouteKey('reason', key)).toBe(true);
    expect(routeKeys('topic')).toStrictEqual(QUEUE_TOPIC_ROLES);
    expect(routeKeys('reason')).toStrictEqual(HANDOFF_REASONS);
  });

  it.each(['en', 'tr'] as const)('words every key in %s', (locale) => {
    for (const type of ['topic', 'reason'] as const) {
      for (const key of routeKeys(type)) {
        expect(hasMessage(locale, routeKeyLabelKey(type, key)), `${type}:${key}`).toBe(true);
      }
    }
  });
});

describe('routeDraftProblems', () => {
  it('needs a team; the blank topic key is a valid one', () => {
    expect(routeDraftProblems(BLANK_ROUTE_DRAFT)).toStrictEqual([
      'playbook.handoff.routes.problem.team',
    ]);
    expect(routeDraftProblems({ ...BLANK_ROUTE_DRAFT, groupId: '4' })).toStrictEqual([]);
  });

  it('refuses a key the type does not take', () => {
    const draft = { ...BLANK_ROUTE_DRAFT, groupId: '4', matchKey: 'repeat_same_day' };
    expect(routeDraftProblems(draft)).toStrictEqual(['playbook.handoff.routes.problem.key']);
    expect(routeDraftProblems({ ...draft, matchType: 'reason' })).toStrictEqual([]);
  });
});

describe('request bodies', () => {
  it('creates with ids as numbers and "no brand / no skill" as null', () => {
    expect(createBody({ ...BLANK_ROUTE_DRAFT, groupId: '4', priority: 'urgent' })).toStrictEqual({
      match_type: 'topic',
      match_key: 'finance',
      brand_id: null,
      group_id: 4,
      required_expertise_id: null,
      default_priority: 'urgent',
      active: true,
    });
    expect(
      createBody({ ...BLANK_ROUTE_DRAFT, groupId: '4', expertiseId: '9', brandId: 'b-1' }),
    ).toMatchObject({ brand_id: 'b-1', required_expertise_id: 9 });
  });

  it('sends an edit only what changed — and never what the route matches', () => {
    const draft = draftOfRoute(ROUTE);
    expect(updateBody(draft, ROUTE)).toStrictEqual({});
    expect(updateBody({ ...draft, groupId: '5' }, ROUTE)).toStrictEqual({ group_id: 5 });
    expect(updateBody({ ...draft, expertiseId: '9', priority: 'high' }, ROUTE)).toStrictEqual({
      required_expertise_id: 9,
      default_priority: 'high',
    });
    const withSkill = { ...ROUTE, required_expertise_id: 9 };
    expect(updateBody({ ...draftOfRoute(withSkill), expertiseId: '' }, withSkill)).toStrictEqual({
      required_expertise_id: null,
    });
  });
});

describe('routeErrorKey', () => {
  it.each([
    'handoff_route_bad_key',
    'handoff_route_taken',
    'handoff_route_unknown_team',
    'handoff_route_unknown_expertise',
    'handoff_route_unknown_brand',
    'handoff_routes_limit',
  ])('names the refusal %s, in both languages', (reason) => {
    const error = new ApiClientError({
      type: 'validation',
      status: 400,
      message: 'x',
      requestId: 'req-1',
      details: { reason },
    });
    const key = routeErrorKey(error);
    expect(key).toBe(`playbook.handoff.routes.error.${reason}`);
    expect(hasMessage('en', key)).toBe(true);
    expect(hasMessage('tr', key)).toBe(true);
  });

  it('falls back to the generic sentence for any other failure', () => {
    expect(routeErrorKey(new Error('boom'))).not.toContain('playbook.handoff.routes');
  });
});
