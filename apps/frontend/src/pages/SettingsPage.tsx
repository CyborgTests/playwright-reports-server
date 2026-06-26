import type { HeaderLink, ServerConfig } from '@playwright-reports/shared';
import { CAPABILITIES } from '@playwright-reports/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import LazyVisible from '@/components/lazy-visible';
import AddLinkModal from '@/components/settings/components/AddLinkModal';
import ApiKeysManagement from '@/components/settings/components/ApiKeysManagement';
import CronConfiguration from '@/components/settings/components/CronConfiguration';
import EnvironmentInfo from '@/components/settings/components/EnvironmentInfo';
import GithubSyncConfiguration from '@/components/settings/components/GithubSyncConfiguration';
import InvitesManagement from '@/components/settings/components/InvitesManagement';
import LLMConfiguration from '@/components/settings/components/LLMConfiguration';
import NotificationsConfiguration from '@/components/settings/components/NotificationsConfiguration';
import OAuthConfiguration from '@/components/settings/components/OAuthConfiguration';
import ServerConfiguration from '@/components/settings/components/ServerConfiguration';
import TestManagementSettings from '@/components/settings/components/TestManagementSettings';
import UsersManagement from '@/components/settings/components/UsersManagement';
import { buildConfigFormData } from '@/components/settings/config-serializers';
import type { EditableSettingsSection } from '@/components/settings/types';
import { Spinner } from '@/components/ui/spinner';
import { useActiveSection } from '@/hooks/useActiveSection';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useCan';
import { useConfig } from '@/hooks/useConfig';
import { authHeaders } from '@/lib/auth';
import { cn } from '@/lib/utils';

const SECTION_NAV: Array<{ id: string; label: string }> = [
  { id: 'environment', label: 'Environment' },
  { id: 'server', label: 'General' },
  { id: 'cron', label: 'Schedules' },
  { id: 'github', label: 'GitHub Sync' },
  { id: 'llm', label: 'LLM Configuration' },
  { id: 'testManagement', label: 'Test Management' },
  { id: 'notifications', label: 'Notifications' },
];

export default function SettingsPage() {
  const session = useAuth();
  const can = useCan();
  const [editingSection, setEditingSection] = useState<EditableSettingsSection>('none');
  const [tempConfig, setTempConfig] = useState<ServerConfig>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);
  const [showAddLinkModal, setShowAddLinkModal] = useState(false);
  const [pendingLinkIcons, setPendingLinkIcons] = useState<Record<string, File>>({});

  const { data: serverConfig, refetch: refetchConfig } = useConfig();
  const [isUpdating, setIsUpdating] = useState(false);

  const config = useMemo<ServerConfig>(() => serverConfig ?? {}, [serverConfig]);

  useEffect(() => {
    if (!serverConfig || editingSection !== 'none') return;
    setTempConfig({
      ...serverConfig,
      llm: serverConfig.llm || {},
      testManagement: serverConfig.testManagement || {},
    });
  }, [serverConfig, editingSection]);

  const handleSave = async (section: Exclude<EditableSettingsSection, 'none'>) => {
    setIsUpdating(true);

    try {
      const formData = buildConfigFormData(section, tempConfig, config, {
        logoFile,
        faviconFile,
        pendingLinkIcons,
      });

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

  const authEnabled = session.data?.authMode === 'enabled';
  const isAdmin = session.data?.user.role === 'admin';
  const currentUserId = session.data?.user.id ?? null;

  // github/llm/notifications stay visible to everyone (reader-allowed run/test
  // actions); their config controls are gated inside the components.
  const visibleConfigNav = SECTION_NAV.filter((s) => {
    if (s.id === 'server' || s.id === 'cron' || s.id === 'testManagement') {
      return can(CAPABILITIES.configServer);
    }
    return true; // environment, github, llm, notifications (view + test for everyone)
  });
  const navSections: Array<{ id: string; label: string }> = [
    ...visibleConfigNav,
    ...(authEnabled && isAdmin
      ? [
          { id: 'users', label: 'Users' },
          { id: 'invites', label: 'Invites' },
        ]
      : []),
    ...(authEnabled && can(CAPABILITIES.apiKeysOwn) ? [{ id: 'apiKeys', label: 'API Keys' }] : []),
    ...(authEnabled && can(CAPABILITIES.configSso) ? [{ id: 'sso', label: 'Single Sign-On' }] : []),
  ];

  return (
    <div className="lg:py-4">
      <header className="mb-6 max-w-3xl">
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Configure your server, scheduled cleanup, LLM analysis, and test management policies.
        </p>
      </header>

      <MobileSectionNav items={navSections} />

      <div className="flex gap-8">
        <aside className="hidden lg:block w-52 shrink-0">
          <SectionNav items={navSections} />
        </aside>

        <div className="flex-1 min-w-0 max-w-5xl">
          <EnvironmentInfo />

          {can(CAPABILITIES.configServer) && (
            <>
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
            </>
          )}

          <GithubSyncConfiguration />

          <LLMConfiguration />

          {can(CAPABILITIES.configServer) && (
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
          )}

          <NotificationsConfiguration />

          {authEnabled && isAdmin && (
            <LazyVisible id="users" className="scroll-mt-20" minHeight={240}>
              <UsersManagement currentUserId={currentUserId} />
            </LazyVisible>
          )}
          {authEnabled && isAdmin && (
            <LazyVisible id="invites" className="scroll-mt-20" minHeight={240}>
              <InvitesManagement />
            </LazyVisible>
          )}
          {authEnabled && can(CAPABILITIES.apiKeysOwn) && (
            <LazyVisible id="apiKeys" className="scroll-mt-20" minHeight={240}>
              <ApiKeysManagement canManageAllKeys={can(CAPABILITIES.apiKeysService)} />
            </LazyVisible>
          )}
          {authEnabled && can(CAPABILITIES.configSso) && (
            <LazyVisible id="sso" className="scroll-mt-20" minHeight={240}>
              <OAuthConfiguration />
            </LazyVisible>
          )}
        </div>
      </div>

      <AddLinkModal isOpen={showAddLinkModal} onAddLink={handleAddLink} onCancel={cancelAddLink} />
    </div>
  );
}

type SectionItem = { id: string; label: string };

function SectionNav({ items }: { items: SectionItem[] }) {
  const ids = items.map((s) => s.id);
  const active = useActiveSection(ids);

  return (
    <nav className="sticky top-20 space-y-1 text-sm">
      <p className="px-3 mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      {items.map((item) => {
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

function MobileSectionNav({ items }: { items: SectionItem[] }) {
  const ids = items.map((s) => s.id);
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
        {items.map((item) => {
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
