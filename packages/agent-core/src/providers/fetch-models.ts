import type { ModelsEndpointConfig } from '../common/types/provider.js';
import { getModelDisplayName } from '../common/constants/model-display.js';
import { fetchWithTimeout } from '../utils/fetch.js';

const DEFAULT_TIMEOUT_MS = 15000;

export interface FetchProviderModelsResult {
  success: boolean;
  models?: Array<{ id: string; name: string }>;
  error?: string;
}

export interface FetchProviderModelsOptions {
  endpointConfig: ModelsEndpointConfig;
  apiKey: string;
  timeout?: number;
  /** Override the endpoint URL (e.g., custom OpenAI base URL, Z.AI regional endpoint) */
  urlOverride?: string;
}

/**
 * Build request URL and headers based on endpoint config.
 */
function buildRequest(
  config: ModelsEndpointConfig,
  apiKey: string,
  urlOverride?: string,
): { url: string; headers: Record<string, string> } {
  let url = urlOverride || config.url;
  const headers: Record<string, string> = {};

  if (config.authStyle === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (config.authStyle === 'x-api-key') {
    headers['x-api-key'] = apiKey;
  } else if (config.authStyle === 'query-param') {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}key=${encodeURIComponent(apiKey)}`;
  }

  if (config.extraHeaders) {
    Object.assign(headers, config.extraHeaders);
  }

  return { url, headers };
}

/**
 * Parse models from an OpenAI-compatible response format.
 * Shape: { data: Array<{ id: string; ... }> }
 */
function parseOpenAIResponse(
  data: unknown,
  prefix: string,
  filter?: RegExp,
): Array<{ id: string; name: string }> {
  const response = data as { data?: Array<{ id: string }> };
  if (!response.data || !Array.isArray(response.data)) return [];

  let models = response.data;
  if (filter) {
    models = models.filter((m) => filter.test(m.id));
  }

  return models.map((m) => ({
    id: `${prefix}${m.id}`,
    name: getModelDisplayName(m.id),
  }));
}

/**
 * Parse models from an Anthropic response format.
 * Shape: { data: Array<{ id: string; display_name: string; type: string }> }
 */
function parseAnthropicResponse(
  data: unknown,
  prefix: string,
  filter?: RegExp,
): Array<{ id: string; name: string }> {
  const response = data as {
    data?: Array<{ id: string; display_name?: string; type?: string }>;
  };
  if (!response.data || !Array.isArray(response.data)) return [];

  let models = response.data;
  if (filter) {
    models = models.filter((m) => filter.test(m.id));
  }

  return models.map((m) => ({
    id: `${prefix}${m.id}`,
    name: m.display_name || getModelDisplayName(m.id),
  }));
}

/**
 * Parse models from a Google Generative AI response format.
 * Shape: { models: Array<{ name: string; displayName: string; supportedGenerationMethods: string[] }> }
 */
function parseGoogleResponse(
  data: unknown,
  prefix: string,
  filter?: RegExp,
): Array<{ id: string; name: string }> {
  const response = data as {
    models?: Array<{
      name: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  if (!response.models || !Array.isArray(response.models)) return [];

  // Only include models that support content generation
  const models = response.models.filter((m) =>
    m.supportedGenerationMethods?.includes('generateContent'),
  );

  // Strip "models/" prefix from Google's model names
  const mapped = models.map((m) => {
    const id = m.name.replace(/^models\//, '');
    return { id, displayName: m.displayName || id };
  });

  let filtered = mapped;
  if (filter) {
    filtered = mapped.filter((m) => filter.test(m.id));
  }

  return filtered.map((m) => ({
    id: `${prefix}${m.id}`,
    name: m.displayName || getModelDisplayName(m.id),
  }));
}

const PARSERS: Record<
  ModelsEndpointConfig['responseFormat'],
  (data: unknown, prefix: string, filter?: RegExp) => Array<{ id: string; name: string }>
> = {
  openai: parseOpenAIResponse,
  anthropic: parseAnthropicResponse,
  google: parseGoogleResponse,
};

/**
 * Generic config-driven function to fetch models from any provider API.
 *
 * The behavior is entirely determined by the ModelsEndpointConfig:
 * - `authStyle` controls how the API key is sent
 * - `responseFormat` selects the appropriate response parser
 * - `modelIdPrefix` is prepended to each model ID
 * - `modelFilter` optionally filters model IDs by regex
 */
export async function fetchProviderModels(
  options: FetchProviderModelsOptions,
): Promise<FetchProviderModelsResult> {
  const { endpointConfig, apiKey, urlOverride } = options;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const prefix = endpointConfig.modelIdPrefix || '';

  if (!apiKey) {
    return { success: false, error: 'No API key provided' };
  }

  try {
    const { url, headers } = buildRequest(endpointConfig, apiKey, urlOverride);

    // Retry logic: attempt up to 3 times for transient errors (429, 5xx) or network/timeout
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: unknown = null;
    const t0 = Date.now();

    while (attempt < maxAttempts) {
      attempt += 1;
      const attemptStart = Date.now();
      try {
        const response = await fetchWithTimeout(url, { method: 'GET', headers }, timeout);

        if (!response.ok) {
          const status = response.status;
          const errorData = await response.json().catch(() => ({}));
          const errorMessage =
            (errorData as { error?: { message?: string } })?.error?.message ||
            `API returned status ${status}`;

          // Retry on rate limit or server errors
          if ((status === 429 || status >= 500) && attempt < maxAttempts) {
            const backoff = 500 * attempt; // 500ms, 1000ms, ...
            console.warn(
              `[FetchModels] Attempt ${attempt} failed (${status}). Retrying after ${backoff}ms`,
            );
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }

          return { success: false, error: errorMessage };
        }

        const data = await response.json();
        const parser = PARSERS[endpointConfig.responseFormat];
        const models = parser(data, prefix, endpointConfig.modelFilter);

        const totalMs = Date.now() - t0;
        const attemptMs = Date.now() - attemptStart;
        console.log(
          `[FetchModels] Fetched ${models.length} models from ${endpointConfig.url} in ${attemptMs}ms (attempt ${attempt}, total ${totalMs}ms)`,
        );
        return { success: true, models };
      } catch (err) {
        lastError = err;
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const isNetwork = err instanceof Error && /network|fetch|failed/i.test(err.message || '');

        if (isAbort || isNetwork) {
          if (attempt < maxAttempts) {
            const backoff = 500 * attempt;
            console.warn(
              `[FetchModels] Attempt ${attempt} failed (network/timeout). Retrying after ${backoff}ms`,
              err,
            );
            await new Promise((r) => setTimeout(r, backoff));
            continue;
          }
        }

        // Non-retryable or out of attempts
        break;
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'Failed to fetch models';
    console.warn('[FetchModels] Fetch failed after retries:', message);

    if (lastError instanceof Error && lastError.name === 'AbortError') {
      return { success: false, error: 'Request timed out. Check your internet connection.' };
    }
    return { success: false, error: `Failed to fetch models: ${message}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch models';
    console.warn('[FetchModels] Unexpected failure:', message);
    return { success: false, error: `Failed to fetch models: ${message}` };
  }
}
