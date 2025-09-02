'use client';

import { Card, CardBody, CardHeader, Input, Button, Divider, Chip } from '@heroui/react';
import { useRef, useState } from 'react';

import { ServerConfig } from '../types';

import { defaultLinks } from '@/app/config/site';

interface ServerConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: 'none' | 'server' | 'jira' | 'cron';
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
  onAddHeaderLink: () => void;
}

export default function ServerConfiguration({
  config,
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
  onAddHeaderLink,
}: ServerConfigurationProps) {
  const logoFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [faviconFile, setFaviconFile] = useState<File | null>(null);

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
    const file = e.target.files?.[0] || null;

    setLogoFile(file);
    if (file) {
      onUpdateTempConfig({ logoPath: `/${file.name}` });
    }
  };

  const handleFaviconFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;

    setFaviconFile(file);
    if (file) {
      onUpdateTempConfig({ faviconPath: `/${file.name}` });
    }
  };

  const resetLogo = () => {
    setLogoFile(null);
    onUpdateTempConfig({ logoPath: '/logo.svg' });
    if (logoFileRef.current) {
      logoFileRef.current.value = '';
    }
  };

  const resetFavicon = () => {
    setFaviconFile(null);
    onUpdateTempConfig({ faviconPath: '/favicon.ico' });
    if (faviconFileRef.current) {
      faviconFileRef.current.value = '';
    }
  };

  return (
    <Card className="mb-6 p-4">
      <CardHeader
        className={`flex justify-between items-center ${editingSection === 'server' ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Server Configuration</h2>
          {editingSection === 'server' && (
            <Chip color="primary" size="sm" variant="flat">
              Editing
            </Chip>
          )}
        </div>
        {editingSection !== 'server' ? (
          <Button color="primary" isDisabled={editingSection !== 'none'} onPress={onEdit}>
            {editingSection === 'none' ? 'Edit Configuration' : 'Section in Use'}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button color="success" isLoading={isUpdating} onPress={onSave}>
              Save Changes
            </Button>
            <Button color="default" onPress={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </CardHeader>
      <CardBody>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="site-title">
              Site Title
            </label>
            <Input
              id="site-title"
              isDisabled={editingSection !== 'server'}
              placeholder="Enter site title"
              value={editingSection === 'server' ? tempConfig.title || '' : config.title || ''}
              onChange={(e) => editingSection === 'server' && onUpdateTempConfig({ title: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="logo-upload">
              Logo
            </label>
            <div className="space-y-3">
              {/* Current logo display */}
              {config.logoPath && (
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex-shrink-0">
                    <img
                      alt="Current logo"
                      className="h-12 w-auto max-w-32 object-contain"
                      src={config.logoPath.startsWith('http') ? config.logoPath : `/api/static${config.logoPath}`}
                    />
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
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
                    <Button color="primary" size="sm" onPress={() => logoFileRef.current?.click()}>
                      {logoFile ? 'Change Logo' : 'Upload Logo'}
                    </Button>
                    {logoFile && <span className="text-sm text-gray-600 dark:text-gray-400">{logoFile.name}</span>}
                    <Button color="warning" size="sm" onPress={resetLogo}>
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

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="favicon-upload">
              Favicon
            </label>
            <div className="space-y-3">
              {config.faviconPath && (
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex-shrink-0">
                    <img
                      alt="Current favicon"
                      className="h-8 w-8 object-contain"
                      src={
                        config.faviconPath.startsWith('http') ? config.faviconPath : `/api/static${config.faviconPath}`
                      }
                    />
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    <p>Current: {config.faviconPath}</p>
                  </div>
                </div>
              )}

              {editingSection === 'server' && (
                <div className="space-y-2">
                  <input
                    ref={faviconFileRef}
                    accept="image/*"
                    className="hidden"
                    id="favicon-upload"
                    type="file"
                    onChange={handleFaviconFileChange}
                  />
                  <div className="flex items-center gap-2">
                    <Button color="primary" size="sm" onPress={() => faviconFileRef.current?.click()}>
                      {faviconFile ? 'Change Favicon' : 'Upload Favicon'}
                    </Button>
                    {faviconFile && (
                      <span className="text-sm text-gray-600 dark:text-gray-400">{faviconFile.name}</span>
                    )}
                    <Button color="warning" size="sm" onPress={resetFavicon}>
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

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="reporter-paths">
              Custom Reporter Paths
            </label>
            <div className="space-y-2">
              {(editingSection === 'server' ? tempConfig.reporterPaths || [] : config.reporterPaths || []).map(
                (path, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      isDisabled={editingSection !== 'server'}
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
                        color="danger"
                        size="sm"
                        onPress={() => {
                          const newPaths = [...(tempConfig.reporterPaths || [])];

                          newPaths.splice(index, 1);
                          onUpdateTempConfig({ reporterPaths: newPaths });
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ),
              )}
              {editingSection === 'server' && (
                <Button
                  className="mr-2"
                  color="primary"
                  size="sm"
                  onPress={() => {
                    const newPaths = [...(tempConfig.reporterPaths || []), ''];

                    onUpdateTempConfig({ reporterPaths: newPaths });
                  }}
                >
                  Add Path
                </Button>
              )}
              {editingSection === 'server' && (
                <Button color="warning" size="sm" onPress={() => onUpdateTempConfig({ reporterPaths: [] })}>
                  Reset
                </Button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Paths to custom Playwright reporter files (relative to project root)
            </p>
          </div>

          <Divider />

          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="block text-sm font-medium">Header Links</span>
              {editingSection === 'server' && (
                <div className="flex gap-2">
                  <Button color="primary" size="sm" onPress={onAddHeaderLink}>
                    Add Link
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {Object.entries(editingSection === 'server' ? tempConfig.headerLinks || {} : config.headerLinks || {})
                .filter(([key]) => key !== 'cyborgTest')
                .map(([key, value]) => {
                  const isDefaultLink = ['github', 'telegram', 'discord'].includes(key);
                  const canReset = ['github', 'telegram', 'discord'].includes(key);

                  return (
                    <div key={key} className="flex gap-2 items-center">
                      <Input className="w-1/3" isDisabled={true} placeholder="Link name" value={key} />
                      <Input
                        className="flex-1"
                        isDisabled={editingSection !== 'server' || isDefaultLink}
                        placeholder="URL"
                        value={value}
                        onChange={(e) => updateHeaderLink(key, e.target.value)}
                      />
                      {editingSection === 'server' && !isDefaultLink && (
                        <Button color="danger" size="sm" onPress={() => removeHeaderLink(key)}>
                          Remove
                        </Button>
                      )}
                      {editingSection === 'server' && canReset && (
                        <Button
                          color="warning"
                          size="sm"
                          onPress={() => updateHeaderLink(key, defaultLinks[key] || '')}
                        >
                          Reset
                        </Button>
                      )}
                    </div>
                  );
                })}
              {Object.keys(editingSection === 'server' ? tempConfig.headerLinks || {} : config.headerLinks || {})
                .length === 0 && <p className="text-gray-500 text-sm">No header links configured</p>}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
