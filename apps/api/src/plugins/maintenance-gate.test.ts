/**
 * What maintenance mode refuses (tm 389.13 · FR-ADMIN-15), by route pattern: `full` everything
 * but health, the deployment notice and signing out; `read_only` every write but signing in and
 * out. The hook against a real server is `test/integration/platform-settings.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { maintenanceRefuses } from './maintenance-gate.js';

describe('maintenanceRefuses', () => {
  it.each([
    ['GET', '/api/v1/health'],
    ['GET', '/api/v1/health/ready'],
    ['GET', '/api/v1/deployment'],
    ['GET', '/api/v1/deployment/notice'],
    ['POST', '/api/v1/auth/revoke'],
    ['OPTIONS', '/api/v1/chats'],
  ])('lets %s %s through in either mode', (method, url) => {
    expect(maintenanceRefuses('full', method, url)).toBe(false);
    expect(maintenanceRefuses('read_only', method, url)).toBe(false);
  });

  it.each([
    ['GET', '/api/v1/chats'],
    ['POST', '/api/v1/auth/login'],
    ['POST', '/api/v1/chats/:chatId/messages'],
    ['POST', '/api/v1/auth/signup'],
  ])('refuses %s %s in full maintenance', (method, url) => {
    expect(maintenanceRefuses('full', method, url)).toBe(true);
  });

  it.each([
    ['GET', '/api/v1/chats'],
    ['HEAD', '/api/v1/chats'],
    ['POST', '/api/v1/auth/login'],
    ['POST', '/api/v1/auth/authorize'],
    ['POST', '/api/v1/auth/token'],
    ['POST', '/api/v1/auth/saml/:connectionId/acs'],
  ])('lets %s %s through in read-only maintenance', (method, url) => {
    expect(maintenanceRefuses('read_only', method, url)).toBe(false);
  });

  it.each([
    ['POST', '/api/v1/chats/:chatId/messages'],
    ['PATCH', '/api/v1/settings/appearance'],
    ['DELETE', '/api/v1/agents/:agentId'],
    ['POST', '/api/v1/auth/signup'],
    ['POST', '/api/v1/auth/invitations/accept'],
  ])('refuses %s %s in read-only maintenance', (method, url) => {
    expect(maintenanceRefuses('read_only', method, url)).toBe(true);
  });

  it('leaves an address that matches no route to answer 404', () => {
    expect(maintenanceRefuses('full', 'GET', undefined)).toBe(false);
  });

  it('matches the route pattern, not a prefix of it', () => {
    // `/api/v1/deployment/notice/x` is not the notice route: refused like any other.
    expect(maintenanceRefuses('full', 'GET', '/api/v1/deployment/noticeboard')).toBe(true);
  });
});
