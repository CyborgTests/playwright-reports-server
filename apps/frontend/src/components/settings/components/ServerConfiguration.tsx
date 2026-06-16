import type { HeaderLink, ServerConfig } from '@playwright-reports/shared';
import { useRef, useState } from 'react';
import { HEADER_LINK_ICON_CATALOG } from '@/components/header-link-icons';
import { LinkIcon } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { withBase } from '@/lib/url';
import SettingsSectionHeader from './SettingsSectionHeader';

const CUSTOM_VALUE = '__custom__';
const NONE_VALUE = '__none__';

function isCustomIconPath(icon: string | undefined): boolean {
  return !!icon && icon.startsWith('/branding/');
}

function iconChoiceFor(icon: string | undefined): string {
  if (!icon) return NONE_VALUE;
  return icon;
}

interface ServerConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: string;
  isUpdating: boolean;
  logoFile: File | null;
  faviconFile: File | null;
  pendingLinkIcons: Record<string, File>;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
  onAddHeaderLink: () => void;
  onUpdateLinkIconFile: (linkId: string, file: File | null) => void;
  onLogoFileChange: (file: File | null) => void;
  onFaviconFileChange: (file: File | null) => void;
}

export default function ServerConfiguration({
  config,
  tempConfig,
  editingSection,
  isUpdating,
  logoFile,
  faviconFile,
  pendingLinkIcons,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
  onAddHeaderLink,
  onUpdateLinkIconFile,
  onLogoFileChange,
  onFaviconFileChange,
}: Readonly<ServerConfigurationProps>) {
  const logoFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);
  const [pendingCustomLinks, setPendingCustomLinks] = useState<Set<string>>(new Set());

  const markPendingCustom = (id: string, isCustom: boolean) => {
    setPendingCustomLinks((prev) => {
      const next = new Set(prev);
      if (isCustom) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const updateLink = (id: string, patch: Partial<HeaderLink>) => {
    const links = tempConfig.headerLinks ?? [];
    onUpdateTempConfig({
      headerLinks: links.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });
  };

  const removeLink = (id: string) => {
    const links = tempConfig.headerLinks ?? [];
    onUpdateTempConfig({ headerLinks: links.filter((l) => l.id !== id) });
    onUpdateLinkIconFile(id, null);
    markPendingCustom(id, false);
  };

  const handleIconChoice = (id: string, choice: string) => {
    if (choice === CUSTOM_VALUE) {
      markPendingCustom(id, true);
      return;
    }
    if (choice === NONE_VALUE) {
      updateLink(id, { icon: undefined });
      onUpdateLinkIconFile(id, null);
      markPendingCustom(id, false);
      return;
    }
    updateLink(id, { icon: choice });
    onUpdateLinkIconFile(id, null);
    markPendingCustom(id, false);
  };

  const handleIconFile = (id: string, file: File | null) => {
    onUpdateLinkIconFile(id, file);
    if (file) markPendingCustom(id, false);
  };

  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onLogoFileChange(e.target.files?.[0] || null);
  };

  const handleFaviconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFaviconFileChange(e.target.files?.[0] || null);
  };

  const resetLogo = () => {
    onLogoFileChange(null);
    onUpdateTempConfig({ logoPath: '/logo.svg' });
    if (logoFileRef.current) {
      logoFileRef.current.value = '';
    }
  };

  const resetFavicon = () => {
    onFaviconFileChange(null);
    onUpdateTempConfig({ faviconPath: '/favicon.ico' });
    if (faviconFileRef.current) {
      faviconFileRef.current.value = '';
    }
  };

  return (
    <Card id="server" className="mb-6 scroll-mt-20 p-4">
      <SettingsSectionHeader
        title="Server Configuration"
        isEditing={editingSection === 'server'}
        canEdit={editingSection === 'none'}
        isUpdating={isUpdating}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
      />
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-title">Site Title</Label>
            <Input
              id="site-title"
              disabled={editingSection !== 'server'}
              placeholder="Enter site title"
              value={editingSection === 'server' ? tempConfig.title || '' : config.title || ''}
              onChange={(e) =>
                editingSection === 'server' && onUpdateTempConfig({ title: e.target.value })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="server-base-url">Server Base URL</Label>
            <Input
              id="server-base-url"
              disabled={editingSection !== 'server'}
              placeholder="https://reports.example.com"
              value={
                editingSection === 'server'
                  ? tempConfig.serverBaseUrl || ''
                  : config.serverBaseUrl || ''
              }
              onChange={(e) =>
                editingSection === 'server' && onUpdateTempConfig({ serverBaseUrl: e.target.value })
              }
            />
            <p className="text-xs text-muted-foreground">
              Externally-visible origin (no trailing slash). Used to build absolute report links in
              notifications. Leave blank to disable links.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="logo-upload">Logo</Label>
            <div className="space-y-3">
              {/* Current logo display */}
              {config.logoPath && (
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-shrink-0">
                    <img
                      alt="Current logo"
                      className="h-12 w-auto max-w-32 object-contain"
                      src={
                        config.logoPath.startsWith('http')
                          ? config.logoPath
                          : `/api/static${config.logoPath}`
                      }
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>Current: {config.logoPath}</p>
                  </div>
                </div>
              )}

              {editingSection === 'server' && (
                <div className="space-y-2">
                  <input
                    ref={logoFileRef}
                    accept="image/*"
                    className="hidden"
                    id="logo-upload"
                    type="file"
                    onChange={handleLogoFileChange}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => logoFileRef.current?.click()}>
                      {logoFile ? 'Change Logo' : 'Upload Logo'}
                    </Button>
                    {logoFile && (
                      <span className="text-sm text-muted-foreground">{logoFile.name}</span>
                    )}
                    <Button variant="outline" size="sm" onClick={resetLogo}>
                      Reset
                    </Button>
                  </div>
                  {logoFile && (
                    <div className="p-2 rounded border border-primary/30 bg-primary/5">
                      <p className="text-xs text-primary">
                        New logo will be uploaded: {logoFile.name}
                      </p>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="logo-invert-dark" className="cursor-pointer">
                    Invert logo on dark theme
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Disable if your logo already looks correct on dark backgrounds.
                  </p>
                </div>
                <Switch
                  id="logo-invert-dark"
                  disabled={editingSection !== 'server'}
                  checked={
                    editingSection === 'server'
                      ? (tempConfig.logoInvertOnDark ?? true)
                      : (config.logoInvertOnDark ?? true)
                  }
                  onCheckedChange={(checked) => {
                    if (editingSection === 'server') {
                      onUpdateTempConfig({ logoInvertOnDark: checked });
                    }
                  }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="favicon-upload">Favicon</Label>
            <div className="space-y-3">
              {config.faviconPath && (
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex-shrink-0">
                    <img
                      alt="Current favicon"
                      className="h-8 w-8 object-contain"
                      src={
                        config.faviconPath.startsWith('http')
                          ? config.faviconPath
                          : `/api/static${config.faviconPath}`
                      }
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    <p>Current: {config.faviconPath}</p>
                  </div>
                </div>
              )}

              {editingSection === 'server' && (
                <div className="space-y-2">
                  <input
                    ref={faviconFileRef}
                    accept="image/x-icon,image/vnd.microsoft.icon,image/png,image/svg+xml,image/*"
                    className="hidden"
                    id="favicon-upload"
                    type="file"
                    onChange={handleFaviconFileChange}
                  />
                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => faviconFileRef.current?.click()}>
                      {faviconFile ? 'Change Favicon' : 'Upload Favicon'}
                    </Button>
                    {faviconFile && (
                      <span className="text-sm text-muted-foreground">{faviconFile.name}</span>
                    )}
                    <Button variant="outline" size="sm" onClick={resetFavicon}>
                      Reset
                    </Button>
                  </div>
                  {faviconFile && (
                    <div className="p-2 rounded border border-primary/30 bg-primary/5">
                      <p className="text-xs text-primary">
                        New favicon will be uploaded: {faviconFile.name}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reporter-paths">Custom Reporter Paths</Label>
            <div className="space-y-2">
              {(editingSection === 'server'
                ? tempConfig.reporterPaths || []
                : config.reporterPaths || []
              ).map((path, index) => (
                <div key={path} className="flex items-center gap-2">
                  <Input
                    disabled={editingSection !== 'server'}
                    placeholder="./data/reporters/reporter.js"
                    value={path}
                    onChange={(e) => {
                      if (editingSection === 'server') {
                        const newPaths = [...(tempConfig.reporterPaths || [])];

                        newPaths[index] = e.target.value;
                        onUpdateTempConfig({ reporterPaths: newPaths });
                      }
                    }}
                  />
                  {editingSection === 'server' && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        const newPaths = [...(tempConfig.reporterPaths || [])];

                        newPaths.splice(index, 1);
                        onUpdateTempConfig({ reporterPaths: newPaths });
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
              {editingSection === 'server' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const newPaths = [...(tempConfig.reporterPaths || []), ''];

                      onUpdateTempConfig({ reporterPaths: newPaths });
                    }}
                  >
                    Add Path
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onUpdateTempConfig({ reporterPaths: [] })}
                  >
                    Reset
                  </Button>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Paths to custom Playwright reporter files.
            </p>
          </div>

          <Separator />

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="block text-sm font-medium">Header Links</span>
              {editingSection === 'server' && (
                <Button size="sm" onClick={onAddHeaderLink}>
                  Add Link
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {(() => {
                const linksForRender =
                  editingSection === 'server'
                    ? (tempConfig.headerLinks ?? [])
                    : (config.headerLinks ?? []);
                const customIconLabels = new Map<string, string>();
                for (const l of linksForRender) {
                  if (l.icon && isCustomIconPath(l.icon) && !customIconLabels.has(l.icon)) {
                    customIconLabels.set(l.icon, l.label?.trim() || 'Custom');
                  }
                }
                const customIconPaths = Array.from(customIconLabels.keys());

                if (!linksForRender.length) {
                  return (
                    <p className="text-muted-foreground text-sm">No header links configured</p>
                  );
                }

                return linksForRender.map((link) => {
                  const choice =
                    pendingLinkIcons[link.id] || pendingCustomLinks.has(link.id)
                      ? CUSTOM_VALUE
                      : iconChoiceFor(link.icon);
                  const pendingFile = pendingLinkIcons[link.id];
                  const isEditingServer = editingSection === 'server';

                  return (
                    <div
                      key={link.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2"
                    >
                      <Select
                        value={choice}
                        onValueChange={(value) => handleIconChoice(link.id, value)}
                        disabled={!isEditingServer}
                      >
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={CUSTOM_VALUE}>Upload new</SelectItem>
                          {customIconPaths.map((path) => (
                            <SelectItem key={path} value={path}>
                              <span className="flex items-center gap-2">
                                <img
                                  alt=""
                                  src={withBase(`/api/static${path}`)}
                                  className="h-4 w-4 object-contain"
                                />
                                {customIconLabels.get(path)}
                              </span>
                            </SelectItem>
                          ))}
                          {HEADER_LINK_ICON_CATALOG.map((preset) => {
                            const Icon = preset.Icon;
                            return (
                              <SelectItem key={preset.name} value={preset.name}>
                                <span className="flex items-center gap-2">
                                  <Icon size={16} />
                                  {preset.title}
                                </span>
                              </SelectItem>
                            );
                          })}
                          <SelectItem value={NONE_VALUE}>
                            <span className="flex items-center gap-2">
                              <LinkIcon width={16} height={16} />
                              Link
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {isEditingServer && choice === CUSTOM_VALUE && (
                        <>
                          <input
                            id={`link-icon-file-${link.id}`}
                            accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif,image/x-icon"
                            type="file"
                            className="hidden"
                            onChange={(e) => handleIconFile(link.id, e.target.files?.[0] || null)}
                          />
                          <Button asChild size="sm" variant="outline">
                            <label htmlFor={`link-icon-file-${link.id}`} className="cursor-pointer">
                              {pendingFile ? 'Change…' : 'Upload…'}
                            </label>
                          </Button>
                          {pendingFile && (
                            <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
                              {pendingFile.name}
                            </span>
                          )}
                        </>
                      )}
                      <Input
                        className="w-36"
                        disabled={!isEditingServer}
                        placeholder="Label"
                        value={link.label}
                        onChange={(e) => updateLink(link.id, { label: e.target.value })}
                      />
                      <Input
                        className="min-w-[12rem] flex-1"
                        disabled={!isEditingServer}
                        placeholder="https://example.com"
                        value={link.url}
                        onChange={(e) => updateLink(link.id, { url: e.target.value })}
                      />
                      <div className="flex items-center gap-1.5">
                        <Checkbox
                          id={`link-show-label-${link.id}`}
                          checked={!!link.showLabel}
                          disabled={!isEditingServer}
                          onCheckedChange={(value) =>
                            updateLink(link.id, { showLabel: value === true ? true : undefined })
                          }
                        />
                        <Label
                          htmlFor={`link-show-label-${link.id}`}
                          className="cursor-pointer text-xs font-normal text-muted-foreground"
                        >
                          Show label
                        </Label>
                      </div>
                      {isEditingServer && (
                        <Button variant="destructive" size="sm" onClick={() => removeLink(link.id)}>
                          Remove
                        </Button>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
