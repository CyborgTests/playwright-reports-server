import type { HeaderLink, ServerConfig } from '@playwright-reports/shared';
import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import AddLinkModal from '@/components/settings/components/AddLinkModal';
import CronConfiguration from '@/components/settings/components/CronConfiguration';
import EnvironmentInfo from '@/components/settings/components/EnvironmentInfo';
import GithubSyncConfiguration from '@/components/settings/components/GithubSyncConfiguration';
import LLMConfiguration from '@/components/settings/components/LLMConfiguration';
import NotificationsConfiguration from '@/components/settings/components/NotificationsConfiguration';
import ServerConfiguration from '@/components/settings/components/ServerConfiguration';
import TestManagementSettings from '@/components/settings/components/TestManagementSettings';
import { Spinner } from '@/components/ui/spinner';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useAuth } from '@/hooks/useAuth';
import { useConfig } from '@/hooks/useConfig';
import { authHeaders } from '@/lib/auth';
import { cn } from '@/lib/utils';

const SECTION_NAV: Array<{ id: string; label: string }> = [
  { id: 'environment', label: 'Environment' },
  { id: 'server', label: 'General' },
  { id: 'cron', label: 'Schedules' },
  { id: 'github', label: 'GitHub Sync' },
  { id: 'llm', label: 'LLM' },
  { id: 'testManagement', label: 'Test Management' },
  { id: 'notifications', label: 'Notifications' },
];

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
    if (!serverConfig) return;
    setConfig(serverConfig);
    if (editingSection !== 'none') return;
    setTempConfig({
      ...serverConfig,
      llm: serverConfig.llm || {},
      testManagement: serverConfig.testManagement || {},
    });
  }, [serverConfig, editingSection]);

  const handleSave = async (section: 'server' | 'cron' | 'llm' | 'testManagement') => {
    setIsUpdating(true);

    try {
      const formData = new FormData();

      if (section === 'server') {
        // Branding fields: send any difference, including blanks. The backend
        // treats blank/whitespace as "reset to default" so users can roll back
        // a customization without re-uploading the original asset.
        if ((tempConfig.title ?? '') !== (config.title ?? '')) {
          formData.append('title', tempConfig.title ?? '');
        }

        if ((tempConfig.serverBaseUrl ?? '') !== (config.serverBaseUrl ?? '')) {
          formData.append('serverBaseUrl', tempConfig.serverBaseUrl ?? '');
        }

        if (logoFile) {
          formData.append('logo', logoFile);
        } else if ((tempConfig.logoPath ?? '') !== (config.logoPath ?? '')) {
          formData.append('logoPath', tempConfig.logoPath ?? '');
        }

        if ((tempConfig.logoInvertOnDark ?? true) !== (config.logoInvertOnDark ?? true)) {
          formData.append(
            'logoInvertOnDark',
            (tempConfig.logoInvertOnDark ?? true) ? 'true' : 'false'
          );
        }

        if (faviconFile) {
          formData.append('favicon', faviconFile);
        } else if ((tempConfig.faviconPath ?? '') !== (config.faviconPath ?? '')) {
          formData.append('faviconPath', tempConfig.faviconPath ?? '');
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
        const cron = tempConfig.cron ?? {};
        formData.append(
          'resultExpireDays',
          cron.resultExpireDays !== undefined ? cron.resultExpireDays.toString() : ''
        );
        formData.append('resultExpireCronSchedule', cron.resultExpireCronSchedule ?? '');
        formData.append(
          'reportExpireDays',
          cron.reportExpireDays !== undefined ? cron.reportExpireDays.toString() : ''
        );
        formData.append('reportExpireCronSchedule', cron.reportExpireCronSchedule ?? '');
      } else if (section === 'llm') {
        if (tempConfig.llm) {
          if (tempConfig.llm.provider) {
            formData.append('llmProvider', tempConfig.llm.provider);
          }
          formData.append('llmBaseUrl', tempConfig.llm.baseUrl ?? '');
          const apiKey = tempConfig.llm.apiKey ?? '';
          if (!/^\*+$/.test(apiKey)) {
            formData.append('llmApiKey', apiKey);
          }
          formData.append('llmModel', tempConfig.llm.model ?? '');
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
          if (tempConfig.llm.autoProjectSummaryOnReportComplete !== undefined) {
            formData.append(
              'llmAutoProjectSummaryOnReportComplete',
              tempConfig.llm.autoProjectSummaryOnReportComplete.toString()
            );
          }
          if (tempConfig.llm.analyzeGreenWindows !== undefined) {
            formData.append(
              'llmAnalyzeGreenWindows',
              tempConfig.llm.analyzeGreenWindows.toString()
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
          formData.append('llmMultimodalMode', tempConfig.llm.multimodalMode ?? '');
          formData.append('llmGeneralContext', tempConfig.llm.generalContext ?? '');
          // Custom prompts — same "send always to allow clearing" pattern.
          // Legacy single field kept for back-compat; per-task fields below win.
          formData.append('llmCustomSystemPrompt', tempConfig.llm.customSystemPrompt ?? '');
          formData.append(
            'llmCustomTestAnalysisSystemPrompt',
            tempConfig.llm.customTestAnalysisSystemPrompt ?? ''
          );
          formData.append(
            'llmCustomProjectSummarySystemPrompt',
            tempConfig.llm.customProjectSummarySystemPrompt ?? ''
          );
          formData.append(
            'llmCustomTestAnalysisInstructions',
            tempConfig.llm.customTestAnalysisInstructions ?? ''
          );
          formData.append(
            'llmCustomReportSummaryPrompt',
            tempConfig.llm.customReportSummaryPrompt ?? ''
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
        headers: authHeaders(),
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
    <div className="lg:py-4">
      <header className="mb-6 max-w-3xl">
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure your server, scheduled cleanup, LLM analysis, and test management policies.
        </p>
      </header>

      <MobileSectionNav />

      <div className="flex gap-8">
        <aside className="hidden lg:block w-52 shrink-0">
          <SectionNav />
        </aside>

        <div className="flex-1 min-w-0 max-w-5xl">
          <EnvironmentInfo />

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

          <GithubSyncConfiguration />

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

          <NotificationsConfiguration />
        </div>
      </div>

      <AddLinkModal isOpen={showAddLinkModal} onAddLink={handleAddLink} onCancel={cancelAddLink} />
    </div>
  );
}

function SectionNav() {
  const ids = SECTION_NAV.map((s) => s.id);
  const active = useActiveSection(ids);

  return (
    <nav className="sticky top-20 space-y-1 text-sm">
      <p className="px-3 mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      {SECTION_NAV.map((item) => {
        const isActive = active === item.id;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'block rounded-md px-3 py-1.5 transition-colors',
              isActive
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function MobileSectionNav() {
  const ids = SECTION_NAV.map((s) => s.id);
  const active = useActiveSection(ids);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    const el = container?.querySelector<HTMLElement>(`[data-section-id="${active}"]`);
    if (!container || !el) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const current = eRect.left - cRect.left;
    const desired = (container.clientWidth - el.offsetWidth) / 2;
    container.scrollTo({ left: container.scrollLeft + (current - desired), behavior: 'smooth' });
  }, [active]);

  return (
    <nav className="lg:hidden sticky top-14 z-30 -mx-4 px-4 mb-4 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40">
      <div ref={scrollRef} className="flex gap-1 overflow-x-auto py-2 text-sm">
        {SECTION_NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <a
              key={item.id}
              data-section-id={item.id}
              href={`#${item.id}`}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'whitespace-nowrap rounded-md px-3 py-1.5 transition-colors shrink-0',
                isActive
                  ? 'bg-accent text-accent-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              {item.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
