import type { ProviderId } from '@navigator_ai/agent-core/common';
import openaiLogo from '/assets/ai-logos/openai.svg';

export const PROVIDER_LOGOS: Record<ProviderId, string> = {
  anthropic: openaiLogo,
  openai: openaiLogo,
  google: openaiLogo,
  xai: openaiLogo,
  deepseek: openaiLogo,
  moonshot: openaiLogo,
  zai: openaiLogo,
  bedrock: openaiLogo,
  vertex: openaiLogo,
  'azure-foundry': openaiLogo,
  ollama: openaiLogo,
  openrouter: openaiLogo,
  litellm: openaiLogo,
  minimax: openaiLogo,
  lmstudio: openaiLogo,
  groq: openaiLogo,
};

export const DARK_INVERT_PROVIDERS = new Set<ProviderId>(
  Object.keys(PROVIDER_LOGOS) as ProviderId[],
);

export function getProviderLogo(providerId: ProviderId): string | undefined {
  return PROVIDER_LOGOS[providerId];
}
