/**
 * Which endpoint answers in which region (NFR-C4 · ADR §7).
 *
 * `LLM_PROVIDER_REGION` is a claim an operator writes down; the residency gate
 * (`services/ai/inference.ts`) trusts it. For the in-process stub the claim is
 * true by construction — it runs wherever the API runs. For a remote endpoint it
 * is only as true as the host the requests actually go to, so production checks
 * the two against each other at boot: a deployment declaring `eu` while its
 * base URL points at the US host would pass every covered workspace's content
 * across the border with the gate reporting that it had not.
 *
 * OpenAI's global host is refused outright. It routes wherever OpenAI decides,
 * so no region can be declared for it truthfully; its regional hosts are the
 * only ones whose processing location is documented (ADR §7, "Data residency").
 */
import type { Region } from '@nexa/types';
import { unhandledLlmProvider, type LlmProviderId } from './llm-provider.js';

/** Hosts whose inference stays in the named region — both cover chat and embeddings. */
export const OPENAI_REGIONAL_HOSTS: Readonly<Record<Region, string>> = {
  us: 'us.api.openai.com',
  eu: 'eu.api.openai.com',
};

const OPENAI_GLOBAL_HOST = 'api.openai.com';

/**
 * Why production may not send inference to `baseUrl` while claiming `region`,
 * or `null` when it may. Names keys and hosts, never a credential — this is the
 * message an operator pastes when asking for help.
 */
export function llmEndpointProblem(
  provider: Exclude<LlmProviderId, 'mock'>,
  baseUrl: string,
  region: Region,
): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'LLM_API_BASE_URL is not a URL.';
  }
  if (url.protocol !== 'https:') {
    return 'LLM_API_BASE_URL must use https in production: the request carries the API key and the conversation.';
  }

  switch (provider) {
    case 'openai': {
      const host = url.hostname.toLowerCase();
      if (host === OPENAI_GLOBAL_HOST) {
        return `LLM_API_BASE_URL points at ${OPENAI_GLOBAL_HOST}, which does not say where it processes requests; use the regional host for LLM_PROVIDER_REGION=${region} (${OPENAI_REGIONAL_HOSTS[region]}).`;
      }
      const hostRegion = (Object.keys(OPENAI_REGIONAL_HOSTS) as Region[]).find(
        (candidate) => OPENAI_REGIONAL_HOSTS[candidate] === host,
      );
      if (!hostRegion) {
        return `LLM_API_BASE_URL host ${host} is not an OpenAI regional host (${Object.values(OPENAI_REGIONAL_HOSTS).join(', ')}), so no region can be claimed for it.`;
      }
      if (hostRegion !== region) {
        return `LLM_PROVIDER_REGION=${region} but LLM_API_BASE_URL is the ${hostRegion} host (${host}): the residency gate would trust a region the requests never go to.`;
      }
      return null;
    }
    default:
      return unhandledLlmProvider(provider);
  }
}
