/**
 * `search_tickets` — the reference MCP tool (FR-MOD-08.8.3-c).
 *
 * Stands in for the free-text search of `GET /tickets`: it runs the same
 * `TicketService.list` query, under the caller's tenant transaction and
 * visibility, and returns the same ticket-page shape. It only reads — the MCP
 * surface never writes — which is why the catalogue gates it behind
 * `tickets--*:ro` (08.8.3-a) and the tool-call surface enforces that before this
 * runs.
 *
 * The tenant boundary is not this executor's to enforce: `ctx.tx` already has
 * the caller's tenant context set (RLS), and `TicketService.list` resolves
 * visibility from the principal. A ticket in another workspace is simply
 * invisible to the query — there is nothing here that could reach across it.
 */
import { TicketService } from '../../tickets/ticket-service.js';
import type { SearchTicketsArgs } from '../tool-catalog.js';
import type { McpToolExecutor } from '../tool-dispatch.js';

const tickets = new TicketService();

export const runSearchTickets: McpToolExecutor = async (ctx, args) => {
  // The tool-call surface validated `args` against the catalogue's
  // `searchTicketsInputSchema` before dispatching, so this shape is guaranteed.
  const { query, view, limit, page_id } = args as SearchTicketsArgs;

  const result = await tickets.list(ctx.tx, ctx.tenant, ctx.principal, {
    view,
    limit,
    query,
    ...(page_id ? { pageId: page_id } : {}),
  });

  // The same page shape `GET /tickets` returns: `items` are already tenant-safe
  // `TicketSummary`s (no license/organization id), and `next_page_id` uses the
  // REST spelling so an MCP client sees one dialect across the API.
  return {
    items: result.items,
    total: result.total,
    ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
  };
};
