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
 *
 * The embedding provider answers to the same rule under its own keys
 * (`EMBEDDING_API_BASE_URL` ↔ `EMBEDDING_PROVIDER_REGION`, tm 255.7): the query
 * path embeds the customer's own message, so it is as much a transfer of
 * content as a completion is (ADR §7).
 */
import type { Region } from '@siyahtus/types';
import { unhandledEmbeddingProvider, type EmbeddingProviderId } from './embedding-provider.js';
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
  const keys = { baseUrl: 'LLM_API_BASE_URL', region: 'LLM_PROVIDER_REGION' };
  const url = httpsUrl(baseUrl, keys, 'the conversation');
  if (typeof url === 'string') return url;
  switch (provider) {
    case 'openai':
      return openAiHostProblem(url, region, keys);
    default:
      return unhandledLlmProvider(provider);
  }
}

/** {@link llmEndpointProblem} for `EMBEDDING_API_BASE_URL` and `EMBEDDING_PROVIDER_REGION`. */
export function embeddingEndpointProblem(
  provider: Exclude<EmbeddingProviderId, 'mock'>,
  baseUrl: string,
  region: Region,
): string | null {
  const keys = { baseUrl: 'EMBEDDING_API_BASE_URL', region: 'EMBEDDING_PROVIDER_REGION' };
  const url = httpsUrl(baseUrl, keys, 'the text it embeds');
  if (typeof url === 'string') return url;
  switch (provider) {
    case 'openai':
      return openAiHostProblem(url, region, keys);
    default:
      return unhandledEmbeddingProvider(provider);
  }
}

interface EndpointKeys {
  baseUrl: string;
  region: string;
}

/** The parsed base URL, or why production refuses it before its host is even looked at. */
function httpsUrl(baseUrl: string, keys: EndpointKeys, carries: string): URL | string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return `${keys.baseUrl} is not a URL.`;
  }
  if (url.protocol !== 'https:') {
    return `${keys.baseUrl} must use https in production: the request carries the API key and ${carries}.`;
  }
  return url;
}

function openAiHostProblem(url: URL, region: Region, keys: EndpointKeys): string | null {
  const host = url.hostname.toLowerCase();
  if (host === OPENAI_GLOBAL_HOST) {
    return `${keys.baseUrl} points at ${OPENAI_GLOBAL_HOST}, which does not say where it processes requests; use the regional host for ${keys.region}=${region} (${OPENAI_REGIONAL_HOSTS[region]}).`;
  }
  const hostRegion = (Object.keys(OPENAI_REGIONAL_HOSTS) as Region[]).find(
    (candidate) => OPENAI_REGIONAL_HOSTS[candidate] === host,
  );
  if (!hostRegion) {
    return `${keys.baseUrl} host ${host} is not an OpenAI regional host (${Object.values(OPENAI_REGIONAL_HOSTS).join(', ')}), so no region can be claimed for it.`;
  }
  if (hostRegion !== region) {
    return `${keys.region}=${region} but ${keys.baseUrl} is the ${hostRegion} host (${host}): the residency gate would trust a region the requests never go to.`;
  }
  return null;
}
