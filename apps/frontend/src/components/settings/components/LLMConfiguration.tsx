'use client';

import type { ServerConfig } from '@playwright-reports/shared';
import { ListTodo } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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

interface LLMConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: string;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

export default function LLMConfiguration({
  config,
  tempConfig,
  editingSection,
  isUpdating,
  onEdit,
  onSave,
  onCancel,
  onUpdateTempConfig,
}: Readonly<LLMConfigurationProps>) {
  const navigate = useNavigate();
  const providers = [
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
  ];

  const isConfigured = config.llm?.baseUrl && config.llm?.apiKey;

  return (
    <Card className="mb-6 p-4">
      <CardHeader
        className={`flex justify-between items-center flex-row ${editingSection === 'llm' ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-500 -mx-4 px-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">LLM Configuration</h2>
          {editingSection === 'llm' && (
            <Badge variant="secondary" className="text-xs">
              Editing
            </Badge>
          )}
        </div>
        {editingSection === 'llm' ? (
          <div className="flex gap-2">
            <Button disabled={isUpdating} onClick={onSave}>
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {isConfigured && (
              <Button variant="outline" onClick={() => navigate('/llm-queue')}>
                <ListTodo className="h-4 w-4 mr-1" />
                LLM Queue
              </Button>
            )}
            <Button disabled={editingSection !== 'none'} onClick={onEdit}>
              {editingSection === 'none' ? 'Edit Configuration' : 'Section in Use'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="llm-provider">LLM Provider</Label>
            <Select
              disabled={editingSection !== 'llm'}
              value={
                editingSection === 'llm'
                  ? tempConfig.llm?.provider || ''
                  : config.llm?.provider || ''
              }
              onValueChange={(value) => {
                if (editingSection === 'llm') {
                  onUpdateTempConfig({
                    llm: { ...tempConfig.llm, provider: value as any },
                  });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select LLM provider" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((provider) => (
                  <SelectItem key={provider.key} value={provider.key}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-base-url">Base URL</Label>
            <Input
              id="llm-base-url"
              disabled={editingSection !== 'llm'}
              placeholder="https://api.openai.com/v1"
              value={
                editingSection === 'llm' ? tempConfig.llm?.baseUrl || '' : config.llm?.baseUrl || ''
              }
              onChange={(e) =>
                editingSection === 'llm' &&
                onUpdateTempConfig({
                  llm: { ...tempConfig.llm, baseUrl: e.target.value },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-api-key">API Key</Label>
            <Input
              id="llm-api-key"
              disabled={editingSection !== 'llm'}
              placeholder="Your API key"
              type="password"
              value={
                editingSection === 'llm' ? tempConfig.llm?.apiKey || '' : config.llm?.apiKey || ''
              }
              onChange={(e) =>
                editingSection === 'llm' &&
                onUpdateTempConfig({
                  llm: { ...tempConfig.llm, apiKey: e.target.value },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-model">Model (Optional)</Label>
            <Input
              id="llm-model"
              disabled={editingSection !== 'llm'}
              placeholder="gpt-4, claude-3-sonnet, etc."
              value={
                editingSection === 'llm' ? tempConfig.llm?.model || '' : config.llm?.model || ''
              }
              onChange={(e) =>
                editingSection === 'llm' &&
                onUpdateTempConfig({
                  llm: { ...tempConfig.llm, model: e.target.value },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-temperature">Temperature (0-2)</Label>
            <Input
              id="llm-temperature"
              disabled={editingSection !== 'llm'}
              placeholder="0.3"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={
                editingSection === 'llm'
                  ? tempConfig.llm?.temperature?.toString() || ''
                  : config.llm?.temperature?.toString() || ''
              }
              onChange={(e) =>
                editingSection === 'llm' &&
                onUpdateTempConfig({
                  llm: {
                    ...tempConfig.llm,
                    temperature: e.target.value ? Number.parseFloat(e.target.value) : undefined,
                  },
                })
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="llm-parallel-requests">Parallel Requests (1-10)</Label>
            <Input
              id="llm-parallel-requests"
              disabled={editingSection !== 'llm'}
              placeholder="1"
              type="number"
              min="1"
              max="10"
              step="1"
              value={
                editingSection === 'llm'
                  ? tempConfig.llm?.parallelRequests?.toString() || ''
                  : config.llm?.parallelRequests?.toString() || ''
              }
              onChange={(e) =>
                editingSection === 'llm' &&
                onUpdateTempConfig({
                  llm: {
                    ...tempConfig.llm,
                    parallelRequests: e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                  },
                })
              }
            />
          </div>

          <Separator />

          {/* Status Display */}
          {isConfigured ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="default" className="bg-green-600">
                  Configured
                </Badge>
                <span className="text-sm text-muted-foreground">LLM integration is active</span>
              </div>
              {config.llm?.provider && (
                <div>
                  <span className="block text-sm font-medium mb-2">Provider</span>
                  <Badge variant="secondary">
                    {providers.find((p) => p.key === config.llm?.provider)?.label ||
                      config.llm.provider}
                  </Badge>
                </div>
              )}
              {config.llm?.model && (
                <div>
                  <span className="block text-sm font-medium mb-2">Model</span>
                  <Badge variant="secondary">{config.llm.model}</Badge>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Not Configured</Badge>
                <span className="text-sm text-muted-foreground">LLM integration is not set up</span>
              </div>
              <Alert>
                <p className="font-medium mb-2">To enable LLM integration:</p>
                <p className="text-sm text-muted-foreground mb-2">
                  Fill in the LLM configuration fields above and save the configuration.
                </p>
                <p className="text-sm text-muted-foreground">
                  You can also set environment variables as a fallback: LLM_PROVIDER, LLM_BASE_URL,
                  LLM_API_KEY, LLM_MODEL, LLM_TEMPERATURE
                </p>
              </Alert>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
