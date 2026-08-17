/**
 * The AI residency rule (NFR-C4 · C4-e).
 *
 * Four combinations, and all four matter: the negative case — an uncovered
 * workspace on an out-of-region provider — is as much a part of the requirement
 * as the refusal, because a workspace that never signed an agreement must not be
 * subjected to a rule it never agreed to.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api-error.js';
import {
  assertInferenceAllowed,
  inferenceAllowed,
  inferenceLeavesRegion,
  resolveInferenceProvider,
  type InferenceProvider,
} from './inference.js';

const inRegion: InferenceProvider = { id: 'mock', region: 'us' };
const outOfRegion: InferenceProvider = { id: 'mock', region: 'eu' };

describe('resolveInferenceProvider', () => {
  it('places the provider in this process’s region when nothing says otherwise', () => {
    // The truth for an in-process stub: it runs wherever the API runs.
    expect(resolveInferenceProvider({ LLM_PROVIDER: 'mock', NEXA_REGION: 'us' })).toEqual({
      id: 'mock',
      region: 'us',
    });
  });

  it('takes the configured region when a deployment declares one', () => {
    // A deployment pointing at a model service elsewhere has to say so — the
    // default must never assert something false about a remote endpoint.
    expect(
      resolveInferenceProvider({
        LLM_PROVIDER: 'mock',
        NEXA_REGION: 'us',
        LLM_PROVIDER_REGION: 'eu',
      }),
    ).toEqual({ id: 'mock', region: 'eu' });
  });
});

describe('inferenceLeavesRegion', () => {
  it('is about the provider alone, so a caller can skip the scope lookup', () => {
    expect(inferenceLeavesRegion(inRegion, 'us')).toBe(false);
    expect(inferenceLeavesRegion(outOfRegion, 'us')).toBe(true);
  });
});

describe('inferenceAllowed', () => {
  it('allows in-region inference for a covered workspace', () => {
    expect(inferenceAllowed({ provider: inRegion, workspaceRegion: 'us', hipaaScope: true })).toBe(
      true,
    );
  });

  it('refuses out-of-region inference for a covered workspace', () => {
    expect(
      inferenceAllowed({ provider: outOfRegion, workspaceRegion: 'us', hipaaScope: true }),
    ).toBe(false);
  });

  it('allows out-of-region inference for a workspace with no agreement', () => {
    // The constraint arrives with the agreement, not with the deployment. This
    // is the single most important line here: without it, signing a BAA in one
    // workspace would quietly change what every other workspace can do.
    expect(
      inferenceAllowed({ provider: outOfRegion, workspaceRegion: 'us', hipaaScope: false }),
    ).toBe(true);
  });

  it('allows in-region inference for a workspace with no agreement', () => {
    expect(inferenceAllowed({ provider: inRegion, workspaceRegion: 'us', hipaaScope: false })).toBe(
      true,
    );
  });
});

describe('assertInferenceAllowed', () => {
  it('says nothing when the inference is allowed', () => {
    expect(() =>
      assertInferenceAllowed({ provider: inRegion, workspaceRegion: 'us', hipaaScope: true }),
    ).not.toThrow();
  });

  it('refuses with 403 not_allowed, not 421', () => {
    // 421 would tell a correctly-addressed client to go hunting for a door that
    // does not exist: they reached the region that holds their workspace. What
    // is out of place is the deployment's provider, which no retry can fix.
    let thrown: unknown;
    try {
      assertInferenceAllowed({ provider: outOfRegion, workspaceRegion: 'us', hipaaScope: true });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    const error = thrown as ApiError;
    expect(error.type).toBe('not_allowed');
    expect(error.status).toBe(403);
  });

  it('names both regions, because the person who can act on it reads a log', () => {
    try {
      assertInferenceAllowed({ provider: outOfRegion, workspaceRegion: 'us', hipaaScope: true });
      expect.unreachable('the refusal should have thrown');
    } catch (error) {
      expect((error as ApiError).details).toEqual({ region: 'us', provider_region: 'eu' });
    }
  });
});
