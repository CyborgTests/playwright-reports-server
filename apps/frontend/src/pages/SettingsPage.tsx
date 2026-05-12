import type { HeaderLink, ServerConfig } from '@playwright-reports/shared';
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import AddLinkModal from '@/components/settings/components/AddLinkModal';
import CronConfiguration from '@/components/settings/components/CronConfiguration';
import EnvironmentInfo from '@/components/settings/components/EnvironmentInfo';
import GithubSyncConfiguration from '@/components/settings/components/GithubSyncConfiguration';
import LLMConfiguration from '@/components/settings/components/LLMConfiguration';
import ServerConfiguration from '@/components/settings/components/ServerConfiguration';
import TestManagementSettings from '@/components/settings/components/TestManagementSettings';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';

export default function SettingsPage() {
  const session = useAuth();
  const [config, setConfig] = useState<ServerConfig>({});
  const [editingSection, setEditingSection] = useState<
    'none' | 'server' | 'cron' | 'llm' | 'testManagement'
  >('none');
  const [tempConfig, setTempConfig] = useState<ServerConfig>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  // Pending custom icon uploads, keyed by link id. Tracked separately from
  // tempConfig.headerLinks so the JSON payload stays clean.
  const [pendingLinkIcons, setPendingLinkIcons] = useState<Record<string, File>>({});

  const { data: serverConfig, refetch: refetchConfig } = useConfig();
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (serverConfig) {
      setConfig(serverConfig);
      setTempConfig({
        ...serverConfig,
        llm: serverConfig.llm || {},
        testManagement: serverConfig.testManagement || {},
      });
    }
  }, [serverConfig]);

  const handleSave = async (section: 'server' | 'cron' | 'llm' | 'testManagement') => {
    setIsUpdating(true);

    try {
      const formData = new FormData();

      if (section === 'server') {
        if (tempConfig.title && tempConfig.title !== config.title) {
          formData.append('title', tempConfig.title);
        }

        if (logoFile) {
          formData.append('logo', logoFile);
        } else if (tempConfig.logoPath && tempConfig.logoPath !== config.logoPath) {
          formData.append('logoPath', tempConfig.logoPath);
        }

        if (faviconFile) {
          formData.append('favicon', faviconFile);
        } else if (tempConfig.faviconPath && tempConfig.faviconPath !== config.faviconPath) {
          formData.append('faviconPath', tempConfig.faviconPath);
        }

        const reporterPathsChanged =
          JSON.stringify(tempConfig.reporterPaths ?? []) !==
          JSON.stringify(config.reporterPaths ?? []);
        if (reporterPathsChanged) {
          formData.append('reporterPaths', JSON.stringify(tempConfig.reporterPaths ?? []));
        }

        const cleanHeaderLinks = (tempConfig.headerLinks ?? []).map((link) => ({
          id: link.id,
          label: link.label ?? '',
          url: link.url ?? '',
          icon: link.icon,
          showLabel: link.showLabel === true ? true : undefined,
        }));
        const headerLinksChanged =
          JSON.stringify(cleanHeaderLinks) !== JSON.stringify(config.headerLinks ?? []) ||
          Object.keys(pendingLinkIcons).length > 0;
        if (headerLinksChanged) {
          formData.append('headerLinks', JSON.stringify(cleanHeaderLinks));
        }
        for (const [linkId, file] of Object.entries(pendingLinkIcons)) {
          formData.append(`linkIcon:${linkId}`, file);
        }
      } else if (section === 'cron') {
        if (tempConfig.cron) {
          if (tempConfig.cron.resultExpireDays !== undefined) {
            formData.append('resultExpireDays', tempConfig.cron.resultExpireDays.toString());
          }
          if (tempConfig.cron.resultExpireCronSchedule) {
            formData.append('resultExpireCronSchedule', tempConfig.cron.resultExpireCronSchedule);
          }
          if (tempConfig.cron.reportExpireDays !== undefined) {
            formData.append('reportExpireDays', tempConfig.cron.reportExpireDays.toString());
          }
          if (tempConfig.cron.reportExpireCronSchedule) {
            formData.append('reportExpireCronSchedule', tempConfig.cron.reportExpireCronSchedule);
          }
        }
      } else if (section === 'llm') {
        if (tempConfig.llm) {
          if (tempConfig.llm.provider) {
            formData.append('llmProvider', tempConfig.llm.provider);
          }
          if (tempConfig.llm.baseUrl) {
            formData.append('llmBaseUrl', tempConfig.llm.baseUrl);
          }
          if (tempConfig.llm.apiKey && !/^\*+$/.test(tempConfig.llm.apiKey)) {
            formData.append('llmApiKey', tempConfig.llm.apiKey);
          }
          if (tempConfig.llm.model) {
            formData.append('llmModel', tempConfig.llm.model);
          }
          // Per-task temperature overrides. Send always to allow clearing.
          formData.append(
            'llmTestAnalysisTemperature',
            tempConfig.llm.testAnalysisTemperature !== undefined
              ? tempConfig.llm.testAnalysisTemperature.toString()
              : ''
          );
          formData.append(
            'llmReportSummaryTemperature',
            tempConfig.llm.reportSummaryTemperature !== undefined
              ? tempConfig.llm.reportSummaryTemperature.toString()
              : ''
          );
          formData.append(
            'llmProjectSummaryTemperature',
            tempConfig.llm.projectSummaryTemperature !== undefined
              ? tempConfig.llm.projectSummaryTemperature.toString()
              : ''
          );
          if (tempConfig.llm.parallelRequests !== undefined) {
            formData.append('llmParallelRequests', tempConfig.llm.parallelRequests.toString());
          }
          if (tempConfig.llm.autoAnalyzeNewReports !== undefined) {
            formData.append(
              'llmAutoAnalyzeNewReports',
              tempConfig.llm.autoAnalyzeNewReports.toString()
            );
          }
          // New mode/limit fields. We send them on every save so blanking a value
          // (set to undefined in temp state) clears the override on the backend.
          formData.append(
            'llmMaxTokens',
            tempConfig.llm.maxTokens !== undefined ? tempConfig.llm.maxTokens.toString() : ''
          );
          formData.append(
            'llmContextWindow',
            tempConfig.llm.contextWindow !== undefined
              ? tempConfig.llm.contextWindow.toString()
              : ''
          );
          formData.append('llmStructuredOutputMode', tempConfig.llm.structuredOutputMode ?? '');
          formData.append('llmMultimodalMode', tempConfig.llm.multimodalMode ?? '');
          // Custom prompts — same "send always to allow clearing" pattern.
          formData.append('llmCustomSystemPrompt', tempConfig.llm.customSystemPrompt ?? '');
          formData.append(
            'llmCustomTestAnalysisInstructions',
            tempConfig.llm.customTestAnalysisInstructions ?? ''
          );
          formData.append(
            'llmCustomReportSummaryInstructions',
            tempConfig.llm.customReportSummaryInstructions ?? ''
          );
          formData.append(
            'llmCustomProjectSummaryInstructions',
            tempConfig.llm.customProjectSummaryInstructions ?? ''
          );
        }
      } else if (section === 'testManagement') {
        if (tempConfig.testManagement) {
          if (tempConfig.testManagement.quarantineThresholdPercentage !== undefined) {
            formData.append(
              'testManagementQuarantineThresholdPercentage',
              tempConfig.testManagement.quarantineThresholdPercentage.toString()
            );
          }
          if (tempConfig.testManagement.warningThresholdPercentage !== undefined) {
            formData.append(
              'testManagementWarningThresholdPercentage',
              tempConfig.testManagement.warningThresholdPercentage.toString()
            );
          }
          if (tempConfig.testManagement.autoQuarantineEnabled !== undefined) {
            formData.append(
              'testManagementAutoQuarantineEnabled',
              tempConfig.testManagement.autoQuarantineEnabled.toString()
            );
          }
          if (tempConfig.testManagement.flakinessMinRuns !== undefined) {
            formData.append(
              'testManagementFlakinessMinRuns',
              tempConfig.testManagement.flakinessMinRuns.toString()
            );
          }
          if (tempConfig.testManagement.flakinessEvaluationWindowDays !== undefined) {
            formData.append(
              'testManagementFlakinessEvaluationWindowDays',
              tempConfig.testManagement.flakinessEvaluationWindowDays.toString()
            );
          }
        }
      }

      const response = await fetch('/api/config', {
        method: 'PATCH',
        body: formData,
        headers: {
          Authorization: session.data?.user?.apiToken || '',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();

        throw new Error(errorText);
      }

      const sectionName = {
        server: 'Server',
        cron: 'Cron',
        llm: 'LLM',
        testManagement: 'Test Management',
      };
      toast.success(`${sectionName[section]} configuration updated successfully`);
      setEditingSection('none');
      if (section === 'server') {
        setLogoFile(null);
        setFaviconFile(null);
        setPendingLinkIcons({});
      }
      refetchConfig();
    } catch (error) {
      toast.error(
        `Failed to update configuration: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancel = () => {
    setTempConfig({
      ...config,
      llm: config?.llm || {},
      testManagement: config?.testManagement || {},
    });
    setLogoFile(null);
    setFaviconFile(null);
    setPendingLinkIcons({});
    setEditingSection('none');
  };

  const setLinkIconFile = (linkId: string, file: File | null) => {
    setPendingLinkIcons((prev) => {
      const next = { ...prev };
      if (file) next[linkId] = file;
      else delete next[linkId];
      return next;
    });
  };

  const updateTempConfig = (updates: Partial<ServerConfig>) => {
    setTempConfig((prev) => ({ ...prev, ...updates }));
  };

  const addHeaderLink = () => {
    setShowAddLinkModal(true);
  };

  const handleAddLink = (link: HeaderLink, iconFile: File | null) => {
    updateTempConfig({
      headerLinks: [...(tempConfig.headerLinks ?? []), link],
    });
    if (iconFile) {
      setLinkIconFile(link.id, iconFile);
    }
    setShowAddLinkModal(false);
  };

  const cancelAddLink = () => {
    setShowAddLinkModal(false);
  };

  if (session.status === 'loading') {
    return (
      <div className="flex justify-center items-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (serverConfig?.authRequired === true && session.status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>

      <ServerConfiguration
        config={config}
        editingSection={editingSection}
        faviconFile={faviconFile}
        isUpdating={isUpdating}
        logoFile={logoFile}
        pendingLinkIcons={pendingLinkIcons}
        tempConfig={tempConfig}
        onAddHeaderLink={addHeaderLink}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('server')}
        onFaviconFileChange={setFaviconFile}
        onLogoFileChange={setLogoFile}
        onSave={() => handleSave('server')}
        onUpdateLinkIconFile={setLinkIconFile}
        onUpdateTempConfig={updateTempConfig}
      />

      <CronConfiguration
        config={config}
        editingSection={editingSection}
        isUpdating={isUpdating}
        tempConfig={tempConfig}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('cron')}
        onSave={() => handleSave('cron')}
        onUpdateTempConfig={updateTempConfig}
      />

      <LLMConfiguration
        config={config}
        editingSection={editingSection}
        isUpdating={isUpdating}
        tempConfig={tempConfig}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('llm')}
        onSave={() => handleSave('llm')}
        onUpdateTempConfig={updateTempConfig}
      />

      <TestManagementSettings
        config={config}
        editingSection={editingSection}
        isUpdating={isUpdating}
        tempConfig={tempConfig}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('testManagement')}
        onSave={() => handleSave('testManagement')}
        onUpdateTempConfig={updateTempConfig}
      />

      <GithubSyncConfiguration />

      <EnvironmentInfo />

      <AddLinkModal isOpen={showAddLinkModal} onAddLink={handleAddLink} onCancel={cancelAddLink} />
    </div>
  );
}
