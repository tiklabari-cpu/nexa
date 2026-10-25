/**
 * The API image's version — one constant for both processes it runs (tm 389.3):
 * the tenant API (`server.ts`) and the platform process (`platform-server.ts`),
 * which must not import the tenant server's whole module graph to read it.
 */
export const VERSION = '0.1.0';
