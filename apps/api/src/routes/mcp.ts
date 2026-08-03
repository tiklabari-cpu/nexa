/**
 * MCP server — FR-MOD-08.8.3 (v2). The surface an MCP client (Claude, ChatGPT, …)
 * connects to.
 *
 * This slice (08.8.3-b) serves only discovery: `GET /mcp/manifest`. It is
 * authenticated — any agent or bot token, the default principal set — but
 * declares no scope, because the catalogue is a single static list, identical
 * for every caller, and whether a caller may actually run a tool is a call-time
 * decision made against that tool's `requiredScopes` by the tool-call surface
 * (08.8.3-c), not here. A customer (widget) token is turned away with a 404 by
 * the principal-kind gate in the auth plugin, keeping the agent API
 * un-enumerable from the widget (I4/NFR-S5). No tenant data is read or returned,
 * so `public: true` is deliberately *not* used — an unauthenticated caller has no
 * business discovering a workspace's tool surface.
 */
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { scopesOf } from '../services/auth/principal.js';
import { MCP_TOOL_CATALOG } from '../services/mcp/tool-catalog.js';
import { authorizingScope, resolveTool } from '../services/mcp/tool-dispatch.js';

/**
 * The MCP protocol revision this server targets. A constant for now: whether the
 * REST tool surface below is enough or a JSON-RPC/SSE bridge is also needed is an
 * open product question (08.8.3 assumption 10), so this advertises intent rather
 * than certified compliance.
 */
export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpRoutesOptions {
  /** Base URL an MCP client points at — `${API_BASE_URL}${API_PREFIX}/mcp`. */
  serverUrl: string;
  /** This server's version, echoed into the manifest. */
  version: string;
}

export default async function mcpRoutes(
  app: FastifyInstance,
  opts: McpRoutesOptions,
): Promise<void> {
  // Built once at registration: the manifest is static — the same document for
  // every caller — so there is nothing per-request to compute.
  const manifest = {
    protocol_version: MCP_PROTOCOL_VERSION,
    server: { name: 'nexa', url: opts.serverUrl, version: opts.version },
    tools: MCP_TOOL_CATALOG.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      input_schema: tool.inputJsonSchema,
      required_scopes: [...tool.requiredScopes],
    })),
  } as const;

  // Authenticated (agent/bot) but scope-free — see the file header. The auth
  // plugin has already required a valid principal and rejected a customer token
  // with a 404 by the time this handler runs, so there is no check to repeat.
  app.get('/mcp/manifest', async () => manifest);

  // The single generic tool-call surface (08.8.3-c). Every catalogued tool is
  // invoked here — name in the path, arguments in the body — so adding a tool
  // later needs no new route or contract path. This handler is the whole
  // security core: it resolves the tool, gates the caller's scopes against that
  // tool's own requirement, validates the arguments, runs the tool inside the
  // caller's tenant transaction, and audits the call — all in one place, so no
  // seam between "which scope is enough" and "which tenant is visible" can open.
  app.post<{ Params: { tool: string } }>(
    '/mcp/tools/:tool',
    // Read-only tools: they read tickets/chats/reports and never write, so they
    // stay available while a licence is in read-only mode (ADR-10). Without this
    // the license-gate hook would refuse the POST with `license_expired` once a
    // trial lapsed, even though nothing is being written.
    { config: { allowWhenReadOnly: true } },
    async (request, reply) => {
      const principal = request.requirePrincipal();

      // 1. Resolve the tool. Unknown — or catalogued but not yet served — is a
      //    404, never 403/400: the tool surface must not be mappable by probing
      //    names (NFR-S5).
      const resolved = resolveTool(request.params.tool);
      if (!resolved) throw ApiError.notFound('Tool not found.');
      const { descriptor, execute } = resolved;

      // 2. Scope gate — the tool's own required scopes, against this token. A
      //    customer token never reaches here (the auth plugin's principal-kind
      //    gate answered 404 already), so `scopesOf` is the agent/bot scope list.
      //    The scope that passes the gate is recorded below as `scope_used`, so
      //    the decision and its audit reason are the same fact.
      const scopeUsed = authorizingScope(scopesOf(principal), descriptor.requiredScopes);
      if (scopeUsed === undefined) {
        throw ApiError.authorization(
          `This token is missing the required scope (one of: ${descriptor.requiredScopes.join(', ')}).`,
        );
      }

      // 3. Validate the arguments against the tool's own schema. A missing body
      //    means an empty argument object — valid for a tool whose arguments are
      //    all optional, a 400 for one (like search_tickets) that requires some.
      const body = request.body as { arguments?: unknown } | undefined;
      const parsed = descriptor.inputSchema.safeParse(body?.arguments ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw ApiError.validation(
          issue ? `${issue.path.join('.') || 'arguments'}: ${issue.message}` : 'Invalid arguments.',
        );
      }

      const tenant = request.tenant();

      // 4. Run inside the caller's tenant transaction, and write the audit entry
      //    in the SAME transaction so the call and its record commit together.
      //    The tenant context is what stops a tool from ever reaching another
      //    workspace's rows; the executor adds no boundary of its own.
      const result = await request.withTenant(async (tx) => {
        const output = await execute({ tx, tenant, principal }, parsed.data);
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'mcp.tool_called',
          target: `mcp_tool:${descriptor.name}`,
          // The tool and the scope that authorised it — never the arguments (a
          // search query is user content / possible PII) or the result.
          metadata: { tool: descriptor.name, scope_used: scopeUsed },
        });
        return output;
      });

      // No tenant identifier rides along: `descriptor.name` echoed for
      // correlation, `result` is the tool's own (tenant-safe) output.
      return reply.send({ tool: descriptor.name, result });
    },
  );
}
