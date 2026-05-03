'use client';

import type { ServerConfig } from '@playwright-reports/shared';
import { useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { defaultLinks } from '@/config/site';

interface ServerConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: string;
  isUpdating: boolean;
  logoFile: File | null;
  faviconFile: File | null;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
  onAddHeaderLink: () => void;
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
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
  onAddHeaderLink,
  onLogoFileChange,
  onFaviconFileChange,
}: Readonly<ServerConfigurationProps>) {
  const logoFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);

  const updateHeaderLink = (key: string, value: string) => {
    onUpdateTempConfig({
      headerLinks: {
        ...tempConfig.headerLinks,
        [key]: value,
      },
    });
  };

  const removeHeaderLink = (key: string) => {
    const newHeaderLinks = { ...tempConfig.headerLinks };

    delete newHeaderLinks[key];
    onUpdateTempConfig({ headerLinks: newHeaderLinks });
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
    <Card className="mb-6 p-4">
      <CardHeader
        className={`flex justify-between items-center flex-row ${editingSection === 'server' ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 -mx-4 px-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Server Configuration</h2>
          {editingSection === 'server' && (
            <Badge variant="secondary" className="text-xs">
              Editing
            </Badge>
          )}
        </div>
        {editingSection === 'server' ? (
          <div className="flex gap-2">
            <Button disabled={isUpdating} onClick={onSave}>
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button disabled={editingSection !== 'none'} onClick={onEdit}>
            {editingSection === 'none' ? 'Edit Configuration' : 'Section in Use'}
          </Button>
        )}
      </CardHeader>
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
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        New logo will be uploaded: {logoFile.name}
                      </p>
                    </div>
                  )}
                </div>
              )}
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
                    <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
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
                <div className="flex gap-2">
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
              Paths to custom Playwright reporter files (relative to project root)
            </p>
          </div>

          <Separator />

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="block text-sm font-medium">Header Links</span>
              {editingSection === 'server' && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={onAddHeaderLink}>
                    Add Link
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {Object.entries(
                editingSection === 'server'
                  ? tempConfig.headerLinks || {}
                  : config.headerLinks || {}
              )
                .filter(([key]) => key !== 'cyborgTest')
                .map(([key, value]) => {
                  const isDefaultLink = ['github', 'telegram', 'discord'].includes(key);
                  const canReset = ['github', 'telegram', 'discord'].includes(key);

                  return (
                    <div key={key} className="flex gap-2 items-center">
                      <Input
                        className="w-1/3"
                        disabled={true}
                        placeholder="Link name"
                        value={key}
                      />
                      <Input
                        className="flex-1"
                        disabled={editingSection !== 'server' || isDefaultLink}
                        placeholder="URL"
                        value={value}
                        onChange={(e) => updateHeaderLink(key, e.target.value)}
                      />
                      {editingSection === 'server' && !isDefaultLink && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => removeHeaderLink(key)}
                        >
                          Remove
                        </Button>
                      )}
                      {editingSection === 'server' && canReset && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateHeaderLink(key, defaultLinks[key] || '')}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  );
                })}
              {Object.keys(
                editingSection === 'server'
                  ? tempConfig.headerLinks || {}
                  : config.headerLinks || {}
              ).length === 0 && (
                <p className="text-muted-foreground text-sm">No header links configured</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
