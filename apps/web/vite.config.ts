import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const API_TARGET = process.env['API_BASE_URL'] ?? 'http://localhost:4000';

/**
 * Source maps are on for every build except the container image's
 * (tm 256.5): the Dockerfile sets `SIYAHTUS_BUILD_SOURCEMAPS=false`, so the
 * served bundle neither ships `.map` files nor names one. Only `false` turns
 * them off.
 */
const SOURCEMAPS = process.env['SIYAHTUS_BUILD_SOURCEMAPS'] !== 'false';

/** Long-cached vendor chunks: package name → chunk. Everything else stays in the app chunk. */
const VENDOR_CHUNKS: Record<string, string> = {
  react: 'react',
  'react-dom': 'react',
  scheduler: 'react',
  'react-router': 'react',
  'react-router-dom': 'react',
  cookie: 'react',
  'set-cookie-parser': 'react',
  '@tanstack/react-query': 'query',
  '@tanstack/query-core': 'query',
};

/**
 * The API documentation lives at `/developers/docs/` (KN-04). nginx sends the
 * address without its slash to the one with it; the dev server would otherwise
 * answer it with the panel's shell, so a developer typing the short address
 * locally would see the panel and not the page.
 */
function docsTrailingSlash(): Plugin {
  return {
    name: 'siyahtus-docs-trailing-slash',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] === '/developers/docs') {
          response.statusCode = 301;
          response.setHeader('Location', '/developers/docs/');
          response.end();
          return;
        }
        next();
      });
    },
  };
}

/**
 * On a private e2e stack only (tm 463): one line per `/api` request as this
 * server receives it and one as it answers, into `web-shard-<i>.log` beside the
 * shard's API log. The suite's rarest red is a panel request that never comes
 * back while the API log shows it never arrived (`customers.spec` search,
 * `two-factor.spec` roster); this is the hop in between, so the next one says
 * whether the dev server's proxy ever had it. Unset — every other run — the
 * plugin is not installed.
 */
function e2eRequestLog(): Plugin[] {
  const dir = process.env['SIYAHTUS_E2E_SERVER_LOG_DIR'];
  const shard = process.env['SIYAHTUS_E2E_SHARD'];
  if (!dir || shard === undefined) return [];
  return [
    {
      name: 'siyahtus-e2e-request-log',
      configureServer(server) {
        const log = createWriteStream(join(dir, `web-shard-${shard}.log`), { flags: 'a' });
        let next = 0;
        server.middlewares.use((request, response, proceed) => {
          if (!request.url?.startsWith('/api/')) return proceed();
          const id = (next += 1);
          const started = Date.now();
          const write = (event: string, extra: Record<string, unknown> = {}): void => {
            const line = {
              time: Date.now(),
              id,
              event,
              method: request.method,
              url: request.url?.split('?')[0],
              ...extra,
            };
            log.write(`${JSON.stringify(line)}\n`);
          };
          write('received', { port: request.socket.remotePort });
          response.on('finish', () =>
            write('answered', { status: response.statusCode, ms: Date.now() - started }),
          );
          response.on('close', () => {
            if (!response.writableFinished)
              write('closed unanswered', { ms: Date.now() - started });
          });
          proceed();
        });
      },
    },
  ];
}

/**
 * On a private e2e stack only (tm 463.4): the dev server also takes connections on
 * `127.0.0.1:<port>` and hands them to the same HTTP server, so Chromium's IPv4 fallback has
 * somewhere to land.
 *
 * Measured with Chromium's net-log (`SIYAHTUS_E2E_NETLOG_DIR`, customers ×20, 2/140 red): every
 * "request that never came back" was a TCP connect to `[::1]:<port>` that never completed. The
 * connect job's own fallback to `127.0.0.1` at +300 ms was refused (Vite listens on `::1` only),
 * the pool's 250 ms backup socket went to another queued request, and the stalled one waited on
 * the hung connect until the test gave up. With an IPv4 listener the fallback connects and the
 * request goes out ~300 ms late. A second `net.Server` on loopback, not `host: '::'`: the dev
 * server stays off the LAN. Unset — every other run — the plugin is not installed.
 */
function e2eIpv4Listener(): Plugin[] {
  if (process.env['SIYAHTUS_E2E_SHARD'] === undefined) return [];
  return [
    {
      name: 'siyahtus-e2e-ipv4-listener',
      configureServer(server) {
        const http = server.httpServer;
        if (!http) return;
        http.once('listening', () => {
          const address = http.address();
          // Already on IPv4 (a machine whose `localhost` resolves there first): nothing to add.
          if (!address || typeof address === 'string' || !String(address.family).includes('6')) {
            return;
          }
          const ipv4 = createServer((socket) => http.emit('connection', socket));
          ipv4.on('error', (error) =>
            server.config.logger.warn(`e2e IPv4 listener on ${address.port}: ${error.message}`),
          );
          ipv4.listen(address.port, '127.0.0.1');
          http.once('close', () => ipv4.close());
        });
      },
    },
  ];
}

export default defineConfig({
  plugins: [react(), docsTrailingSlash(), ...e2eRequestLog(), ...e2eIpv4Listener()],
  // A second dev server beside the usual one (the pilot e2e stack,
  // `apps/e2e/playwright.pilot.config.ts`) needs its own dependency cache, or
  // its optimizer rewrites `.vite/deps` under the running one. Unset, Vite's
  // default.
  ...(process.env['SIYAHTUS_VITE_CACHE_DIR']
    ? { cacheDir: process.env['SIYAHTUS_VITE_CACHE_DIR'] }
    : {}),
  server: {
    port: Number(process.env['WEB_PORT'] ?? 5173),
    // Proxy in dev so the browser sees a same-origin API and cookies behave
    // exactly as they will behind a shared gateway in production.
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: SOURCEMAPS,
    rollupOptions: {
      // Two pages: the panel, and the public API documentation (KN-04), which is
      // served at /developers/docs/ without a sign-in and shares nothing with the panel's bundle.
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        docs: resolve(import.meta.dirname, 'developers/docs/index.html'),
      },
      output: {
        // Matched by package directory, not listed by import name. Since v7,
        // react-router-dom only re-exports react-router, which this app does not
        // depend on directly, so the object form cannot resolve it and the
        // router would land in the app chunk.
        manualChunks(id) {
          const pkg = /.*[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id)?.[1];
          return pkg ? VENDOR_CHUNKS[pkg.replace('\\', '/')] : undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // A hang guard, not a speed budget: inside the DoD gate every package runs
    // at once and a 1 s render test was measured past 5 s and 20 s (tm 311.3).
    // api and rtm use the same 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
