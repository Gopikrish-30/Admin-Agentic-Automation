import { AnimatePresence, motion } from 'framer-motion';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { settingsVariants, settingsTransitions } from '@/lib/animations';
import { getAdminApp } from '@/lib/navigator-app';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ProviderId, ConnectedProvider } from '@navigator_ai/agent-core/common';
import { isProviderReady } from '@navigator_ai/agent-core/common';
import { useProviderSettings } from '@/components/settings/hooks/useProviderSettings';
import { ProviderGrid } from '@/components/settings/ProviderGrid';
import { ProviderSettingsPanel } from '@/components/settings/ProviderSettingsPanel';
import { Key } from '@phosphor-icons/react';

const OPENAI_PROVIDER_ID: ProviderId = 'openai';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApiKeySaved?: () => void;
  initialProvider?: ProviderId;
  initialTab?: 'providers';
}

export function SettingsDialog({
  open,
  onOpenChange,
  onApiKeySaved,
  initialProvider,
  initialTab: _initialTab = 'providers',
}: SettingsDialogProps) {
  const { t } = useTranslation('settings');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [closeWarning, setCloseWarning] = useState(false);
  const [showModelError, setShowModelError] = useState(false);

  const {
    settings,
    loading,
    setActiveProvider,
    connectProvider,
    disconnectProvider,
    updateModel,
    refetch,
  } = useProviderSettings();

  // Debug mode state - stored in appSettings, not providerSettings
  const navigatorApp = getAdminApp();

  // Refetch settings when dialog opens
  useEffect(() => {
    if (!open) return;
    refetch();
  }, [open, refetch, navigatorApp]);

  // Reset/initialize state when dialog opens or closes
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset on close
      setSelectedProvider(null);
      setCloseWarning(false);
      setShowModelError(false);
    }
  }, [open]);

  // Auto-select OpenAI provider when dialog opens.
  useEffect(() => {
    if (!open || loading) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: auto-select on open
    setSelectedProvider(OPENAI_PROVIDER_ID);
  }, [open, loading, initialProvider]);

  // Handle close attempt
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && settings) {
        const openAIReady = isProviderReady(settings.connectedProviders[OPENAI_PROVIDER_ID]);
        if (!openAIReady) {
          setCloseWarning(true);
          return;
        }
      }
      setCloseWarning(false);
      onOpenChange(newOpen);
    },
    [settings, onOpenChange],
  );

  // Handle provider selection
  const handleSelectProvider = useCallback(
    async (providerId: ProviderId) => {
      if (providerId !== OPENAI_PROVIDER_ID) {
        return;
      }
      setSelectedProvider(providerId);
      setCloseWarning(false);
      setShowModelError(false);

      // Auto-set as active if the selected provider is ready
      const provider = settings?.connectedProviders?.[providerId];
      if (provider && isProviderReady(provider)) {
        await setActiveProvider(providerId);
      }
    },
    [settings?.connectedProviders, setActiveProvider],
  );

  // Handle provider connection
  const handleConnect = useCallback(
    async (provider: ConnectedProvider) => {
      if (provider.providerId !== OPENAI_PROVIDER_ID) {
        return;
      }
      await connectProvider(provider.providerId, provider);

      // Auto-set as active if the new provider is ready (connected + has model selected)
      // This ensures newly connected ready providers become active, regardless of
      // whether another provider was already active
      if (isProviderReady(provider)) {
        await setActiveProvider(provider.providerId);
        onApiKeySaved?.();
      }
    },
    [connectProvider, setActiveProvider, onApiKeySaved],
  );

  // Handle provider disconnection
  const handleDisconnect = useCallback(async () => {
    if (!selectedProvider) return;
    await disconnectProvider(selectedProvider);
    setSelectedProvider(null);
    await setActiveProvider(null);
  }, [selectedProvider, disconnectProvider, setActiveProvider]);

  // Handle model change
  const handleModelChange = useCallback(
    async (modelId: string) => {
      if (!selectedProvider) return;
      await updateModel(selectedProvider, modelId);

      // Auto-set as active if this provider is now ready
      const provider = settings?.connectedProviders[selectedProvider];
      if (provider && isProviderReady({ ...provider, selectedModelId: modelId })) {
        if (!settings?.activeProviderId || settings.activeProviderId !== selectedProvider) {
          await setActiveProvider(selectedProvider);
        }
      }

      setShowModelError(false);
      onApiKeySaved?.();
    },
    [selectedProvider, updateModel, settings, setActiveProvider, onApiKeySaved],
  );

  // Handle done button (close with validation)
  const handleDone = useCallback(() => {
    if (!settings) return;

    const openAIProvider = settings.connectedProviders[OPENAI_PROVIDER_ID];
    const openAIReady = isProviderReady(openAIProvider);

    // Check if selected provider needs a model
    if (selectedProvider) {
      const provider = settings.connectedProviders[selectedProvider];
      if (provider?.connectionStatus === 'connected' && !provider.selectedModelId) {
        setShowModelError(true);
        return;
      }
    }

    // Check OpenAI provider readiness for mock-admin-only mode
    if (!openAIReady) {
      setCloseWarning(true);
      return;
    }

    if (settings.activeProviderId !== OPENAI_PROVIDER_ID) {
      setActiveProvider(OPENAI_PROVIDER_ID);
    }

    onOpenChange(false);
  }, [settings, selectedProvider, onOpenChange, setActiveProvider]);

  // Force close (dismiss warning)
  const handleForceClose = useCallback(() => {
    setCloseWarning(false);
    onOpenChange(false);
  }, [onOpenChange]);

  if (loading || !settings) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-4xl w-full h-[80vh] flex flex-col overflow-hidden p-0"
          data-testid="settings-dialog"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-4xl w-full h-[65vh] flex overflow-hidden p-0"
        data-testid="settings-dialog"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        {/* Left sidebar navigation (provider-only mode) */}
        <nav className="w-48 shrink-0 border-r border-border bg-muted/30 p-3 flex flex-col gap-1">
          <div className="px-3 py-2 mb-1">
            <span className="text-sm font-semibold text-foreground pl-1.5">Admin</span>
          </div>
          <button className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left bg-background text-foreground shadow-sm">
            <Key className="h-4 w-4 shrink-0" />
            {t('tabs.providers')}
          </button>
        </nav>

        {/* Right content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Content header with title + optional actions */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('tabs.providers')}</h3>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <div className="space-y-6">
              {/* Close Warning */}
              <AnimatePresence>
                {closeWarning && (
                  <motion.div
                    className="rounded-lg border border-warning bg-warning/10 p-4 mb-6"
                    variants={settingsVariants.fadeSlide}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={settingsTransitions.enter}
                  >
                    <div className="flex items-start gap-3">
                      <svg
                        className="h-5 w-5 text-warning flex-shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-warning">
                          {t('warnings.noProviderReady')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {t('warnings.noProviderReadyDescription')}
                        </p>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={handleForceClose}
                            className="rounded-md px-3 py-1.5 text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80"
                          >
                            {t('warnings.closeAnyway')}
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-6">
                <section>
                  <ProviderGrid
                    settings={settings}
                    selectedProvider={selectedProvider}
                    onSelectProvider={handleSelectProvider}
                  />
                </section>

                <AnimatePresence>
                  {selectedProvider && (
                    <motion.section
                      variants={settingsVariants.slideDown}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      transition={settingsTransitions.enter}
                    >
                      <ProviderSettingsPanel
                        key={selectedProvider}
                        providerId={selectedProvider}
                        connectedProvider={settings?.connectedProviders?.[selectedProvider]}
                        onConnect={handleConnect}
                        onDisconnect={handleDisconnect}
                        onModelChange={handleModelChange}
                        showModelError={showModelError}
                      />
                    </motion.section>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer: Add (skills only) + Done */}
              <div className="mt-4 flex items-center justify-between">
                <div />
                <button
                  onClick={handleDone}
                  className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  data-testid="settings-done-button"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  {t('buttons.done')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SettingsDialog;
