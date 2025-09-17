'use client';

import { Card, CardBody, CardHeader, Input, Button, Divider, Chip } from '@heroui/react';

import { ServerConfig, JiraConfig } from '../types';

interface JiraConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  jiraConfig?: JiraConfig;
  editingSection: 'none' | 'server' | 'jira' | 'cron';
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

export default function JiraConfiguration({
  config,
  tempConfig,
  jiraConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: JiraConfigurationProps) {
  return (
    <Card className="mb-6 p-4">
      <CardHeader
        className={`flex justify-between items-center ${editingSection === 'jira' ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">Jira Integration</h2>
          {editingSection === 'jira' && (
            <Chip color="primary" size="sm" variant="flat">
              Editing
            </Chip>
          )}
        </div>
        {editingSection !== 'jira' ? (
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
            <label className="block text-sm font-medium mb-2" htmlFor="jira-base-url">
              Jira Base URL
            </label>
            <Input
              id="jira-base-url"
              isDisabled={editingSection !== 'jira'}
              placeholder="https://your-domain.atlassian.net"
              value={editingSection === 'jira' ? tempConfig.jira?.baseUrl || '' : config.jira?.baseUrl || ''}
              onChange={(e) =>
                editingSection === 'jira' &&
                onUpdateTempConfig({
                  jira: { ...tempConfig.jira, baseUrl: e.target.value },
                })
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="jira-email">
              Jira Email
            </label>
            <Input
              id="jira-email"
              isDisabled={editingSection !== 'jira'}
              placeholder="your-email@example.com"
              value={editingSection === 'jira' ? tempConfig.jira?.email || '' : config.jira?.email || ''}
              onChange={(e) =>
                editingSection === 'jira' &&
                onUpdateTempConfig({
                  jira: { ...tempConfig.jira, email: e.target.value },
                })
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="jira-api-token">
              Jira API Token
            </label>
            <Input
              id="jira-api-token"
              isDisabled={editingSection !== 'jira'}
              placeholder="Your Jira API token"
              type="password"
              value={editingSection === 'jira' ? tempConfig.jira?.apiToken || '' : config.jira?.apiToken || ''}
              onChange={(e) =>
                editingSection === 'jira' &&
                onUpdateTempConfig({
                  jira: { ...tempConfig.jira, apiToken: e.target.value },
                })
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2" htmlFor="jira-project-key">
              Default Project Key (Optional)
            </label>
            <Input
              id="jira-project-key"
              isDisabled={editingSection !== 'jira'}
              placeholder="PROJECT"
              value={editingSection === 'jira' ? tempConfig.jira?.projectKey || '' : config.jira?.projectKey || ''}
              onChange={(e) =>
                editingSection === 'jira' &&
                onUpdateTempConfig({
                  jira: { ...tempConfig.jira, projectKey: e.target.value },
                })
              }
            />
          </div>

          <Divider />

          {/* Status Display */}
          {jiraConfig?.configured ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Chip color="success" size="sm">
                  Configured
                </Chip>
                <span className="text-sm text-gray-600">Jira integration is active</span>
              </div>
              {jiraConfig.issueTypes && jiraConfig.issueTypes.length > 0 && (
                <div>
                  <span className="block text-sm font-medium mb-1">Available Issue Types</span>
                  <div className="flex flex-wrap gap-1">
                    {jiraConfig.issueTypes.map((type) => (
                      <Chip key={type.id} size="sm" variant="flat">
                        {type.name}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : jiraConfig?.error ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Chip color="danger" size="sm">
                  Error
                </Chip>
                <span className="text-sm text-gray-600">Jira integration failed</span>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
                <h3 className="font-medium text-red-800 dark:text-red-200 mb-2">Connection Error</h3>
                <p className="text-sm text-red-700 dark:text-red-300">{jiraConfig.error}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Chip color="warning" size="sm">
                  Not Configured
                </Chip>
                <span className="text-sm text-gray-600">Jira integration is not set up</span>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                <h3 className="font-medium mb-2">To enable Jira integration:</h3>
                <p className="text-sm text-gray-600 mb-2">
                  Fill in the Jira configuration fields above and save the configuration.
                </p>
                <p className="text-sm text-gray-600">
                  You can also set environment variables as a fallback: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN,
                  JIRA_PROJECT_KEY
                </p>
              </div>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
