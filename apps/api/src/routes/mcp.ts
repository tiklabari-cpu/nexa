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
import { MCP_TOOL_CATALOG } from '../services/mcp/tool-catalog.js';

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
}
