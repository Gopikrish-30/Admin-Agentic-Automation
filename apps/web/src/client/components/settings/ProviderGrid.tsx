import { useTranslation } from 'react-i18next';
import type { ProviderId, ProviderSettings } from '@navigator_ai/agent-core/common';
import { ProviderCard } from './ProviderCard';

const OPENAI_ONLY_PROVIDER: ProviderId = 'openai';

interface ProviderGridProps {
  settings: ProviderSettings;
  selectedProvider: ProviderId | null;
  onSelectProvider: (providerId: ProviderId) => void;
}

export function ProviderGrid({ settings, selectedProvider, onSelectProvider }: ProviderGridProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="rounded-xl border border-border bg-provider-bg p-4" data-testid="provider-grid">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-foreground">{t('providers.title')}</span>
        <span className="text-xs text-muted-foreground">OpenAI</span>
      </div>

      <div className="grid grid-cols-1 gap-3 min-h-[110px] justify-items-center">
        <ProviderCard
          providerId={OPENAI_ONLY_PROVIDER}
          connectedProvider={settings?.connectedProviders?.[OPENAI_ONLY_PROVIDER]}
          isActive={settings?.activeProviderId === OPENAI_ONLY_PROVIDER}
          isSelected={selectedProvider === OPENAI_ONLY_PROVIDER}
          onSelect={onSelectProvider}
        />
      </div>
    </div>
  );
}
