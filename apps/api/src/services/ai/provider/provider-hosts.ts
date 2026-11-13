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
 * Anthropic (tm 479) has one host, `api.anthropic.com`, and keeps the region
 * in each request instead (`inference_geo`). It can pin the US and nothing
 * else, so `us` is the only region production accepts for it.
 *
 * The embedding provider answers to the same rule under its own keys
 * (`EMBEDDING_API_BASE_URL` ↔ `EMBEDDING_PROVIDER_REGION`, tm 255.7): the query
 * path embeds the customer's own message, so it is as much a transfer of
 * content as a completion is (ADR §7).
 */
import type { Region } from '@siyahtus/types';
import { ANTHROPIC_DEFAULT_BASE_URL, ANTHROPIC_INFERENCE_GEO } from './anthropic-llm-provider.js';
import { unhandledEmbeddingProvider, type EmbeddingProviderId } from './embedding-provider.js';
import { unhandledLlmProvider, type LlmProviderId } from './llm-provider.js';

/** Hosts whose inference stays in the named region — both cover chat and embeddings. */
export const OPENAI_REGIONAL_HOSTS: Readonly<Record<Region, string>> = {
  us: 'us.api.openai.com',
  eu: 'eu.api.openai.com',
};

const OPENAI_GLOBAL_HOST = 'api.openai.com';

/**
 * Anthropic's one API host (tm 479 · ADR §13). Its region is not in the host
 * but in each request: `inference_geo: 'us'` pins inference to the US
 * (`anthropic-llm-provider.ts`). There is no EU pin, so no EU claim can be
 * made for this provider.
 */
export const ANTHROPIC_API_HOST = new URL(ANTHROPIC_DEFAULT_BASE_URL).hostname;

/**
 * The base URL a provider uses when `LLM_API_BASE_URL` is unset: Anthropic's
 * API host; `null` for a provider that has no default and needs the setting.
 */
export function defaultLlmBaseUrl(provider: Exclude<LlmProviderId, 'mock'>): string | null {
  switch (provider) {
    case 'openai':
      return null;
    case 'anthropic':
      return ANTHROPIC_DEFAULT_BASE_URL;
    default:
      return unhandledLlmProvider(provider);
  }
}

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
    case 'anthropic':
      return anthropicHostProblem(url, region, keys);
    default:
      return unhandledLlmProvider(provider);
  }
}

function anthropicHostProblem(url: URL, region: Region, keys: EndpointKeys): string | null {
  const host = url.hostname.toLowerCase();
  if (host !== ANTHROPIC_API_HOST) {
    return `${keys.baseUrl} host ${host} is not Anthropic's API host (${ANTHROPIC_API_HOST}), so no region can be claimed for it.`;
  }
  if (ANTHROPIC_INFERENCE_GEO[region] === null) {
    return `${keys.region}=${region} cannot be kept with LLM_PROVIDER=anthropic: Anthropic pins inference to the US (inference_geo us) or runs it globally, and has no ${region} pin.`;
  }
  return null;
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
