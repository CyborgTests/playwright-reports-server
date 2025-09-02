'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useSession } from 'next-auth/react';

import { ServerConfig, JiraConfig } from './types';
import ServerConfiguration from './components/ServerConfiguration';
import JiraConfiguration from './components/JiraConfiguration';
import CronConfiguration from './components/CronConfiguration';
import AddLinkModal from './components/AddLinkModal';
import EnvironmentInfo from './components/EnvironmentInfo';

import useQuery from '@/app/hooks/useQuery';

export default function SettingsPage() {
  const session = useSession();
  const [config, setConfig] = useState<ServerConfig>({});
  const [editingSection, setEditingSection] = useState<'none' | 'server' | 'jira' | 'cron'>('none');
  const [tempConfig, setTempConfig] = useState<ServerConfig>({});
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  const [newLinkData, setNewLinkData] = useState({ name: '', url: '' });

  const { data: serverConfig, refetch: refetchConfig } = useQuery<ServerConfig>('/api/config');
  const { data: jiraConfig } = useQuery<JiraConfig>('/api/jira/config');

  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (serverConfig) {
      setConfig(serverConfig);
      setTempConfig({
        ...serverConfig,
        jira: serverConfig.jira || {},
      });
    }
  }, [serverConfig]);

  const handleSave = async (section: 'server' | 'jira' | 'cron') => {
    setIsUpdating(true);

    try {
      const formData = new FormData();

      if (section === 'server') {
        formData.append('title', tempConfig.title || '');

        if (tempConfig.logoPath && tempConfig.logoPath !== config.logoPath) {
          const logoInput = document.getElementById('logo-upload') as HTMLInputElement;

          if (logoInput && logoInput.files && logoInput.files[0]) {
            formData.append('logo', logoInput.files[0]);
          } else {
            formData.append('logoPath', tempConfig.logoPath);
          }
        }

        if (tempConfig.faviconPath && tempConfig.faviconPath !== config.faviconPath) {
          const faviconInput = document.getElementById('favicon-upload') as HTMLInputElement;

          if (faviconInput && faviconInput.files && faviconInput.files[0]) {
            formData.append('favicon', faviconInput.files[0]);
          } else {
            formData.append('faviconPath', tempConfig.faviconPath);
          }
        }

        if (tempConfig.reporterPaths) {
          formData.append('reporterPaths', JSON.stringify(tempConfig.reporterPaths));
        }

        const cleanHeaderLinks = Object.fromEntries(
          Object.entries(tempConfig.headerLinks || {}).filter(([_, value]) => value !== undefined),
        );

        formData.append('headerLinks', JSON.stringify(cleanHeaderLinks));
      } else if (section === 'jira') {
        if (tempConfig.jira) {
          if (tempConfig.jira.baseUrl) {
            formData.append('jiraBaseUrl', tempConfig.jira.baseUrl);
          }
          if (tempConfig.jira.email) {
            formData.append('jiraEmail', tempConfig.jira.email);
          }
          if (tempConfig.jira.apiToken) {
            formData.append('jiraApiToken', tempConfig.jira.apiToken);
          }
          if (tempConfig.jira.projectKey) {
            formData.append('jiraProjectKey', tempConfig.jira.projectKey);
          }
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

      toast.success(
        `${section === 'server' ? 'Server' : section === 'jira' ? 'Jira' : 'Cron'} configuration updated successfully`,
      );
      setEditingSection('none');
      refetchConfig();
    } catch (error) {
      toast.error(`Failed to update configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCancel = () => {
    setTempConfig({
      ...config,
      jira: config?.jira || {},
    });
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
      console.log('Added link:', newLinkData.name, 'with URL:', newLinkData.url);
      setNewLinkData({ name: '', url: '' });
      setShowAddLinkModal(false);
    }
  };

  const cancelAddLink = () => {
    setNewLinkData({ name: '', url: '' });
    setShowAddLinkModal(false);
  };

  if (session.status === 'loading') {
    return <div>Loading...</div>;
  }

  if (session.status === 'unauthenticated') {
    return <div>Please log in to access settings.</div>;
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Settings</h1>

      <ServerConfiguration
        config={config}
        editingSection={editingSection}
        isUpdating={isUpdating}
        tempConfig={tempConfig}
        onAddHeaderLink={addHeaderLink}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('server')}
        onSave={() => handleSave('server')}
        onUpdateTempConfig={updateTempConfig}
      />

      <JiraConfiguration
        config={config}
        editingSection={editingSection}
        isUpdating={isUpdating}
        jiraConfig={jiraConfig}
        tempConfig={tempConfig}
        onCancel={handleCancel}
        onEdit={() => setEditingSection('jira')}
        onSave={() => handleSave('jira')}
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
