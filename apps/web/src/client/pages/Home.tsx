import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { TaskInputBar } from '@/components/landing/TaskInputBar';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { useTaskStore } from '@/stores/taskStore';
import { getAdminApp } from '@/lib/navigator-app';
import { springs } from '@/lib/animations';
import { hasAnyReadyProvider } from '@navigator_ai/agent-core/common';

export function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [speechConfigChanged, setSpeechConfigChanged] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'providers'>('providers');
  const { startTask, interruptTask, isLoading, addTaskUpdate, setPermissionRequest } =
    useTaskStore();
  const navigate = useNavigate();
  const navigatorApp = useMemo(() => getAdminApp(), []);
  const { t } = useTranslation('home');

  useEffect(() => {
    const unsubscribeTask = navigatorApp.onTaskUpdate((event) => {
      addTaskUpdate(event);
    });

    const unsubscribePermission = navigatorApp.onPermissionRequest((request) => {
      setPermissionRequest(request);
    });

    return () => {
      unsubscribeTask();
      unsubscribePermission();
    };
  }, [addTaskUpdate, setPermissionRequest, navigatorApp]);

  const executeTask = useCallback(async () => {
    if (!prompt.trim() || isLoading) return;

    const taskId = `task_${Date.now()}`;
    const task = await startTask({ prompt: prompt.trim(), taskId });
    if (task) {
      navigate(`/execution/${task.id}`);
    }
  }, [prompt, isLoading, startTask, navigate]);

  const handleSubmit = async () => {
    if (isLoading) {
      void interruptTask();
      return;
    }
    if (!prompt.trim()) return;

    const settings = await navigatorApp.getProviderSettings();
    if (!hasAnyReadyProvider(settings)) {
      setSettingsInitialTab('providers');
      setShowSettingsDialog(true);
      return;
    }

    await executeTask();
  };

  const handleSettingsDialogChange = (open: boolean) => {
    setShowSettingsDialog(open);
    if (!open) {
      setSettingsInitialTab('providers');
      setSpeechConfigChanged((prev) => !prev);
    }
  };

  const handleOpenSpeechSettings = useCallback(() => {
    setSettingsInitialTab('providers');
    setShowSettingsDialog(true);
  }, []);

  const handleOpenModelSettings = useCallback(() => {
    setSettingsInitialTab('providers');
    setShowSettingsDialog(true);
  }, []);

  const handleApiKeySaved = async () => {
    setShowSettingsDialog(false);
    if (prompt.trim()) {
      await executeTask();
    }
  };

  return (
    <>
      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={handleSettingsDialogChange}
        onApiKeySaved={handleApiKeySaved}
        initialTab={settingsInitialTab}
      />

      <div className="h-full flex flex-col bg-accent relative overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="w-full max-w-[720px] mx-auto flex flex-col items-center px-6 min-h-full justify-center py-8">
            <div className="flex flex-col items-center gap-3 w-full mb-8">
              <motion.h1
                data-testid="home-title"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.gentle}
                className="font-apparat text-[32px] tracking-[-0.015em] text-foreground w-full text-center"
              >
                {t('title')}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ ...springs.gentle, delay: 0.05 }}
                className="text-sm text-muted-foreground text-center max-w-md"
              >
                {t('inputPlaceholder')}
              </motion.p>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...springs.gentle, delay: 0.1 }}
              className="w-full"
            >
              <TaskInputBar
                value={prompt}
                onChange={setPrompt}
                onSubmit={handleSubmit}
                isLoading={isLoading}
                placeholder={t('inputPlaceholder')}
                typingPlaceholder={true}
                large={true}
                autoFocus={true}
                onOpenSpeechSettings={handleOpenSpeechSettings}
                onOpenModelSettings={handleOpenModelSettings}
                onSpeechConfigChanged={speechConfigChanged}
                hideModelWhenNoModel={true}
              />
            </motion.div>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-[80px] bg-gradient-to-t from-accent to-transparent" />
      </div>
    </>
  );
}
