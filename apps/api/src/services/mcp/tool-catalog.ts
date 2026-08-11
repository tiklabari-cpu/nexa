/**
 * MCP tool catalog — pure data (FR-MOD-08.8.3-a).
 *
 * The static description of the four tools an MCP client can discover and call:
 * `name`, `title`, `description`, an input schema (zod for runtime validation +
 * its hand-written JSON Schema equivalent, for the discovery manifest), and
 * `requiredScopes`. No enforcement, route or contract lives here — this module
 * only says what a tool call must look like and what scope it needs; the gate
 * that checks a caller's scopes against `requiredScopes`, the tenant-scoped
 * dispatch, and the `GET /mcp/manifest` endpoint that serves this catalog are
 * later, separate slices (08.8.3-b/-c).
 *
 * `requiredScopes` values are copied verbatim from the routes each tool stands
 * in for, not re-derived:
 *   - search_tickets → `apps/api/src/routes/tickets.ts` `READ_SCOPES`
 *     (`GET /tickets`), minus the `:rw` variant — this MCP surface is read-only.
 *   - list_chats     → `apps/api/src/routes/chats.ts` `GET /chats`.
 *   - get_report     → `apps/api/src/routes/reports.ts` (`reports_read`,
 *     shared by all four report endpoints the `report` enum below selects
 *     between).
 *   - summarize_chat → same scope as `list_chats`: it reads a chat's transcript
 *     and never writes (unlike `POST /copilot/chats/:chatId/summary`, which
 *     also files an internal note — this tool does not).
 *
 * Reference pattern: the `as const` catalog + typed lookup helper shape of
 * `packages/types/src/apps.ts` (`APP_CATALOG` / `findApp`) and
 * `apps/api/src/services/audit/audit-log.ts` (`AUDIT_ACTIONS`).
 */
import { z } from 'zod';
import { isScope, type Scope } from '@nexa/types';

/** One MCP tool's static description, discoverable and callable by a client. */
export interface McpToolDescriptor<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** Runtime validator for a tool call's arguments. */
  readonly inputSchema: TSchema;
  /** JSON Schema equivalent of `inputSchema`, for the discovery manifest. */
  readonly inputJsonSchema: Record<string, unknown>;
  /** OR semantics — a caller needs at least one of these (`hasAnyScope`). */
  readonly requiredScopes: readonly Scope[];
}

// --- search_tickets ---------------------------------------------------------
// Mirrors `listQuery` in `apps/api/src/routes/tickets.ts`, with `query`
// promoted from an optional filter to a required search term — a tool named
// "search" with nothing to search for is not a valid call.

const searchTicketsInputSchema = z.object({
  query: z.string().trim().min(1).max(320),
  view: z.enum(['all', 'unassigned', 'my_open', 'solved']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

const searchTicketsInputJsonSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 320 },
    view: { type: 'string', enum: ['all', 'unassigned', 'my_open', 'solved'], default: 'all' },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    page_id: { type: 'string', maxLength: 512 },
  },
  required: ['query'],
  additionalProperties: false,
} as const;

/** Parsed, validated arguments to `search_tickets` — the tool-call surface
 * (08.8.3-c) validates the request body against `searchTicketsInputSchema` and
 * hands the executor this shape. */
export type SearchTicketsArgs = z.infer<typeof searchTicketsInputSchema>;

// --- list_chats --------------------------------------------------------------
// Mirrors `listQuery` in `apps/api/src/routes/chats.ts`. Every field is
// already optional there (a filter-less call lists everything the caller can
// see), so this stays that way — unlike search_tickets, nothing here is
// promoted to required.

const listChatsInputSchema = z.object({
  view: z.enum(['all', 'my', 'queued', 'unassigned', 'archived', 'ai', 'ai_solved']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

const listChatsInputJsonSchema = {
  type: 'object',
  properties: {
    view: {
      type: 'string',
      enum: ['all', 'my', 'queued', 'unassigned', 'archived', 'ai', 'ai_solved'],
      default: 'all',
    },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
    page_id: { type: 'string', maxLength: 512 },
  },
  required: [],
  additionalProperties: false,
} as const;

/** Parsed, validated arguments to `list_chats` — the tool-call surface (08.8.3-c)
 * validates the request body against `listChatsInputSchema` and hands the
 * executor this shape. */
export type ListChatsArgs = z.infer<typeof listChatsInputSchema>;

// --- get_report ---------------------------------------------------------------
// `report` selects which of the four `reports_read` endpoints
// (`apps/api/src/routes/reports.ts`: overview/breakdown/ai-agent/reviews) to
// run; `from`/`to` mirror their shared `rangeQuery`.

const getReportInputSchema = z.object({
  report: z.enum(['overview', 'breakdown', 'ai-agent', 'reviews']),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const getReportInputJsonSchema = {
  type: 'object',
  properties: {
    report: { type: 'string', enum: ['overview', 'breakdown', 'ai-agent', 'reviews'] },
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
  },
  required: ['report'],
  additionalProperties: false,
} as const;

/** Parsed, validated arguments to `get_report` — the tool-call surface (08.8.3-c)
 * validates the request body against `getReportInputSchema` and hands the
 * executor this shape. */
export type GetReportArgs = z.infer<typeof getReportInputSchema>;

// --- summarize_chat ------------------------------------------------------------
// `chat_id` mirrors the `:chatId` path param of `POST /copilot/chats/:chatId/summary`
// — the single generic MCP tool-call endpoint has no path params, so the id
// moves into the argument body instead.

const summarizeChatInputSchema = z.object({
  chat_id: z.string().trim().min(1).max(12),
});

const summarizeChatInputJsonSchema = {
  type: 'object',
  properties: {
    chat_id: { type: 'string', minLength: 1, maxLength: 12 },
  },
  required: ['chat_id'],
  additionalProperties: false,
} as const;

/** Parsed, validated arguments to `summarize_chat` — the tool-call surface
 * (08.8.3-c) validates the request body against `summarizeChatInputSchema` and
 * hands the executor this shape. */
export type SummarizeChatArgs = z.infer<typeof summarizeChatInputSchema>;

/**
 * The MCP tool catalog. Exactly the four tools the PRD names (KK
 * "search_tickets/list_chats/get_report/summarize_chat tool'ları") — adding a
 * fifth or renaming one of these is a scope decision this module does not
 * make on its own.
 */
export const MCP_TOOL_CATALOG = [
  {
    name: 'search_tickets',
    title: 'Search tickets',
    description: 'Search this workspace’s tickets by free-text query, optionally filtered by view.',
    inputSchema: searchTicketsInputSchema,
    inputJsonSchema: searchTicketsInputJsonSchema,
    requiredScopes: ['tickets--all:ro', 'tickets--access:ro'],
  },
  {
    name: 'list_chats',
    title: 'List chats',
    description: 'List this workspace’s chats, optionally filtered by view.',
    inputSchema: listChatsInputSchema,
    inputJsonSchema: listChatsInputJsonSchema,
    requiredScopes: ['chats--all:ro', 'chats--access:ro'],
  },
  {
    name: 'get_report',
    title: 'Get report',
    description:
      'Fetch one of this workspace’s reports (overview, breakdown, ai-agent or reviews) for a date range.',
    inputSchema: getReportInputSchema,
    inputJsonSchema: getReportInputJsonSchema,
    requiredScopes: ['reports_read'],
  },
  {
    name: 'summarize_chat',
    title: 'Summarize chat',
    description: 'Summarize a chat’s transcript. Read-only — does not file an internal note.',
    inputSchema: summarizeChatInputSchema,
    inputJsonSchema: summarizeChatInputJsonSchema,
    requiredScopes: ['chats--all:ro', 'chats--access:ro'],
  },
] as const satisfies readonly McpToolDescriptor[];

export type McpToolName = (typeof MCP_TOOL_CATALOG)[number]['name'];

/** The catalog entry for `name`, or `undefined` if it names no MCP tool. */
export function toolByName(name: string): McpToolDescriptor | undefined {
  return MCP_TOOL_CATALOG.find((tool) => tool.name === name);
}

// Every `requiredScopes` entry above must be a real, currently-defined scope
// (`packages/types/src/scopes.ts`) — a typo here would silently gate a tool
// behind a scope nothing can ever hold. Asserted at module load, not just in
// the test suite, so a bad edit fails immediately in any environment that
// imports this module.
for (const tool of MCP_TOOL_CATALOG) {
  for (const scope of tool.requiredScopes) {
    if (!isScope(scope)) {
      throw new TypeError(`MCP tool "${tool.name}" requires unknown scope "${scope}"`);
    }
  }
}
