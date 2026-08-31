/**
 * `list_chats` — MCP adapter for `GET /chats` (FR-MOD-08.8.3-d).
 *
 * Stands in for the chat inbox listing: it runs the same
 * `listChatsInTenant` query `ChatService.list` uses, under the caller's
 * tenant transaction and visibility, and returns the same chat-page shape.
 * Read-only, like every MCP tool — which is why the catalogue gates it
 * behind `chats--*:ro` (08.8.3-a) and the tool-call surface enforces that
 * before this runs.
 *
 * `listChatsInTenant` (not `ChatService.list`) is what this calls: the
 * latter opens its own tenant transaction, and Prisma transactions do not
 * nest — `ctx.tx` here is already the caller's open transaction (from
 * `request.withTenant` in `routes/mcp.ts`), so the query must run directly
 * on it rather than through a second, independent `withTenant`.
 *
 * As with `search_tickets`, the tenant boundary is not this executor's to
 * enforce: `ctx.tx` already carries the caller's tenant context (RLS), and
 * `listChatsInTenant` resolves visibility from the principal. A chat in
 * another workspace is simply invisible to the query.
 */
import { listChatsInTenant } from '../../chat/chat-service.js';
import type { ListChatsArgs } from '../tool-catalog.js';
import type { McpToolExecutor } from '../tool-dispatch.js';

export const runListChats: McpToolExecutor = async (ctx, args) => {
  // The tool-call surface validated `args` against the catalogue's
  // `listChatsInputSchema` before dispatching, so this shape is guaranteed.
  const { view, limit, page_id } = args as ListChatsArgs;

  const result = await listChatsInTenant(ctx.tx, ctx.principal, {
    view,
    // The REST endpoint's `sort` (GET /chats) has no MCP counterpart — every
    // other optional filter on that route stays unexposed here too (see the
    // catalogue's `listChatsInputSchema` comment), so this always lists
    // newest-first, the route's own default.
    sort: 'newest',
    limit,
    ...(page_id ? { pageId: page_id } : {}),
  });

  // The same page shape `GET /chats` returns: `items` are already
  // tenant-safe `ChatSummary`s, and `total`/`next_page_id` use the REST
  // spelling so an MCP client sees one dialect across the API. `total` matters
  // more here than anywhere: a model that can only see one page has no way to
  // tell "these are all of them" from "these are the first twenty-five", and
  // will state the page size as the answer.
  return {
    items: result.items,
    total: result.total,
    ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
  };
};
