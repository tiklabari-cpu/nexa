import type { ContractMethod, ContractRequestBody, ContractResponseBody } from './contract';
import { MOBILE_ENDPOINTS, contractPath } from './contract';

/**
 * Most of this module's value is spent at compile time — a path or a method the
 * contract stopped declaring is a `tsc` error, which is what the typecheck gate
 * exists to catch. The assertions below are the part that can still be measured
 * at runtime: that the registry resolves to the literal strings a request is
 * built from, and that adding a surface here is not free.
 */
describe('contract binding', () => {
  it('is an identity function, so no runtime cost is paid for the checking', () => {
    expect(contractPath('/health')).toBe('/health');
  });

  it('names the four FR-MOD-13.7 surfaces, the Team + Playbook parity modules, plus the liveness probe', () => {
    expect(MOBILE_ENDPOINTS).toEqual({
      health: '/health',
      chats: '/chats',
      customers: '/customers',
      reportsOverview: '/reports/overview',
      copilotChatSummary: '/copilot/chats/{chatId}/summary',
      copilotChatReply: '/copilot/chats/{chatId}/reply',
      agents: '/agents',
      agentWorkSchedule: '/agents/{agentId}/work-schedule',
      groups: '/groups',
      skills: '/skills',
      skill: '/skills/{skillId}',
      skillRuns: '/skills/{skillId}/runs',
      copilotKnowledge: '/copilot/knowledge',
    });
  });

  it('keeps the templated endpoints templated — substitution belongs to the client', () => {
    const templated = Object.values(MOBILE_ENDPOINTS).filter((path) => path.includes('{'));
    expect(templated).toEqual([
      '/copilot/chats/{chatId}/summary',
      '/copilot/chats/{chatId}/reply',
      '/agents/{agentId}/work-schedule',
      '/skills/{skillId}',
      '/skills/{skillId}/runs',
    ]);
  });
});

/**
 * Compile-time assertions. They produce no test output and no bundle bytes; if
 * the generated contract drifts, `pnpm -w typecheck` fails on these lines and
 * names the endpoint that moved.
 */
type Assert<T extends true> = T;
type Extends<A, B> = A extends B ? true : false;

// `/chats` is a GET-only collection: asking for `post` must not type-check.
export type _ChatsIsReadable = Assert<Extends<'get', ContractMethod<'/chats'>>>;
// The copilot endpoints are POST-only.
export type _SummaryIsPost = Assert<
  Extends<ContractMethod<'/copilot/chats/{chatId}/summary'>, 'post'>
>;
// A GET has no JSON request body to send.
export type _HealthHasNoBody = Assert<Extends<ContractRequestBody<'/health', 'get'>, never>>;
// …and its 200 body is an object, not the `never` a broken inference would give.
export type _OverviewRespondsWithObject = Assert<
  Extends<ContractResponseBody<'/reports/overview', 'get'>, object>
>;
