/**
 * MCP dispatch core (FR-MOD-08.8.3-c) — the parts that are pure and can be
 * proven without a database: the scope gate and tool resolution. The tenant
 * boundary, IDOR-as-404 and audit are HTTP-level properties and live in
 * `test/integration/mcp-tools.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { authorizingScope, resolveTool } from './tool-dispatch.js';

describe('authorizingScope — the tool-call scope gate', () => {
  // The gate returns the scope that authorised the call (recorded as the audit
  // `scope_used`) or undefined when none does (a 403). It must use the platform's
  // implication rules, not exact-string membership.

  it('returns the held scope when it is exactly one of the required', () => {
    expect(
      authorizingScope(['tickets--all:ro'], ['tickets--all:ro', 'tickets--access:ro']),
    ).toBe('tickets--all:ro');
  });

  it('honours :rw ⇒ :ro implication', () => {
    // A read-write token satisfies a read-only requirement.
    expect(authorizingScope(['tickets--all:rw'], ['tickets--all:ro'])).toBe('tickets--all:ro');
  });

  it('honours --all ⇒ --access implication', () => {
    // The broad grant satisfies the narrower requirement of the same resource.
    expect(authorizingScope(['tickets--all:rw'], ['tickets--access:ro'])).toBe('tickets--access:ro');
  });

  it('returns the first required scope the caller holds, not just any', () => {
    // `tickets--all:rw` effectively holds both required scopes; the *first* in
    // the required list is the one recorded, deterministically.
    expect(
      authorizingScope(['tickets--all:rw'], ['tickets--all:ro', 'tickets--access:ro']),
    ).toBe('tickets--all:ro');
  });

  it('is undefined for an empty grant', () => {
    expect(authorizingScope([], ['reports_read'])).toBeUndefined();
  });

  it('is undefined when the grant and requirement are disjoint', () => {
    expect(authorizingScope(['chats--all:ro'], ['reports_read'])).toBeUndefined();
  });
});

describe('resolveTool — callable tool resolution', () => {
  it('resolves the wired reference tool', () => {
    const resolved = resolveTool('search_tickets');
    expect(resolved?.descriptor.name).toBe('search_tickets');
    expect(typeof resolved?.execute).toBe('function');
  });

  it('resolves list_chats', () => {
    const resolved = resolveTool('list_chats');
    expect(resolved?.descriptor.name).toBe('list_chats');
    expect(typeof resolved?.execute).toBe('function');
  });

  it('returns undefined for a name no tool has', () => {
    expect(resolveTool('definitely_not_a_tool')).toBeUndefined();
  });

  it('returns undefined for a catalogued tool not yet served', () => {
    // get_report/summarize_chat are named in the manifest but wired by later
    // slices (08.8.3-e/-f). Until then they are not callable, and the route
    // answers 404 for them — the same as for an unknown name, so the surface
    // stays un-enumerable.
    for (const name of ['get_report', 'summarize_chat']) {
      expect(resolveTool(name), `${name} must not be callable yet`).toBeUndefined();
    }
  });
});
