import type { ServerConfig } from '@playwright-reports/shared';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import AddLinkModal from '@/components/settings/components/AddLinkModal';
import CronConfiguration from '@/components/settings/components/CronConfiguration';
import EnvironmentInfo from '@/components/settings/components/EnvironmentInfo';
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
  const [newLinkData, setNewLinkData] = useState({ name: '', url: '' });

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

        const cleanHeaderLinks = Object.fromEntries(
          Object.entries(tempConfig.headerLinks ?? {}).filter(([_, value]) => value !== undefined)
        );
        const headerLinksChanged =
          JSON.stringify(cleanHeaderLinks) !== JSON.stringify(config.headerLinks ?? {});
        if (headerLinksChanged) {
          formData.append('headerLinks', JSON.stringify(cleanHeaderLinks));
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
          if (tempConfig.llm.apiKey) {
            formData.append('llmApiKey', tempConfig.llm.apiKey);
          }
          if (tempConfig.llm.model) {
            formData.append('llmModel', tempConfig.llm.model);
          }
          if (tempConfig.llm.temperature !== undefined) {
            formData.append('llmTemperature', tempConfig.llm.temperature.toString());
          }
          if (tempConfig.llm.parallelRequests !== undefined) {
            formData.append('llmParallelRequests', tempConfig.llm.parallelRequests.toString());
          }
          if (tempConfig.llm.autoAnalyzeNewReports !== undefined) {
            formData.append(
              'llmAutoAnalyzeNewReports',
              tempConfig.llm.autoAnalyzeNewReports.toString()
            );
          }
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
    setEditingSection('none');
  };

  const updateTempConfig = (updates: Partial<ServerConfig>) => {
    setTempConfig((prev) => ({ ...prev, ...updates }));
  };

  const addHeaderLink = () => {
    setShowAddLinkModal(true);
  };

  const handleAddLink = () => {
    if (newLinkData.name && newLinkData.url) {
      updateTempConfig({
        headerLinks: {
          ...tempConfig.headerLinks,
          [newLinkData.name]: newLinkData.url,
        },
      });
      setNewLinkData({ name: '', url: '' });
      setShowAddLinkModal(false);
    }
  };

  const cancelAddLink = () => {
    setNewLinkData({ name: '', url: '' });
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
    return <div>Please log in to access settings.</div>;
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
        tempConfig={tempConfig}
        onAddHeaderLink={addHeaderLink}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('server')}
        onFaviconFileChange={setFaviconFile}
        onLogoFileChange={setLogoFile}
        onSave={() => handleSave('server')}
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

      <EnvironmentInfo />

      <AddLinkModal
        isOpen={showAddLinkModal}
        newLinkData={newLinkData}
        onAddLink={handleAddLink}
        onCancel={cancelAddLink}
        onUpdateLinkData={setNewLinkData}
      />
    </div>
  );
}
