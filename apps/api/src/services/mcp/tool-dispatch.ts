/**
 * MCP tool dispatch — FR-MOD-08.8.3-c.
 *
 * Two things live here: the table that maps a tool name to the code that runs
 * it, and the pure scope gate the tool-call surface (`routes/mcp.ts`) uses to
 * decide — and record — which scope authorised a call.
 *
 * Resolution is the union of two facts. The catalogue (`tool-catalog.ts`) knows
 * a tool's argument schema and required scopes; this table knows how to execute
 * it. A name in the catalogue but with no executor here — one a later slice
 * (`get_report`/`summarize_chat`, 08.8.3-e/-f) will wire — is *not yet
 * callable*, so it resolves to undefined and the route answers 404, exactly as
 * it does for a name in neither. Neither case reveals which tools might exist
 * (NFR-S5).
 *
 * What is deliberately NOT here: the tenant boundary. An executor is handed a
 * transaction that already has the caller's tenant context set, so isolation is
 * the database's (RLS) to enforce, in one place, rather than something each new
 * tool could get subtly wrong.
 */
import { effectiveScopes } from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { toolByName, type McpToolDescriptor, type McpToolName } from './tool-catalog.js';
import { runListChats } from './tools/list-chats.js';
import { runSearchTickets } from './tools/search-tickets.js';

/** Everything an executor needs to run one tool call, already tenant-scoped. */
export interface McpToolContext {
  /** A transaction with the caller's tenant context set (from `request.withTenant`). */
  tx: TenantClient;
  tenant: TenantContext;
  principal: Principal;
}

/**
 * Runs one tool call. `args` is the request body already validated against the
 * tool's `inputSchema` by the caller, so an executor may trust its shape and
 * narrow it without re-validating.
 */
export type McpToolExecutor = (ctx: McpToolContext, args: unknown) => Promise<unknown>;

/**
 * The dispatch table: tool name → executor. `search_tickets` and `list_chats`
 * are wired; `get_report` and `summarize_chat` are added here by 08.8.3-e/-f.
 */
const EXECUTORS: Partial<Record<McpToolName, McpToolExecutor>> = {
  search_tickets: runSearchTickets,
  list_chats: runListChats,
};

export interface ResolvedTool {
  descriptor: McpToolDescriptor;
  execute: McpToolExecutor;
}

/**
 * The tool named `name`, or undefined when it names no *callable* tool — either
 * unknown to the catalogue, or catalogued but not yet served. The route turns
 * undefined into a 404 (never 403/400), so the surface cannot be enumerated by
 * probing names.
 */
export function resolveTool(name: string): ResolvedTool | undefined {
  const descriptor = toolByName(name);
  if (!descriptor) return undefined;
  const execute = EXECUTORS[descriptor.name as McpToolName];
  if (!execute) return undefined;
  return { descriptor, execute };
}

/**
 * The scope gate, as a pure function: the first of `required` the caller
 * effectively holds, or undefined if none — in which case the call is refused
 * with a 403.
 *
 * Uses the same implication rules as the rest of the platform (`hasAnyScope` /
 * `effectiveScopes`): `:rw` implies `:ro`, and `--all` implies the narrower
 * `--access`/`--my`/`--groups` variants — so a token with `tickets--all:rw`
 * satisfies a `tickets--all:ro` requirement. Returning the matching scope (not
 * just a boolean) lets the caller record it as the audit `scope_used`, so the
 * gate decision and the recorded reason can never disagree.
 */
export function authorizingScope(
  granted: readonly string[],
  required: readonly string[],
): string | undefined {
  const effective = effectiveScopes(granted);
  return required.find((scope) => effective.has(scope));
}
