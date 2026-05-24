'use client';

import type { ServerConfig } from '@playwright-reports/shared';
import { CheckCircle2, ListTodo, Plug, RefreshCw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { useLlmDefaultPrompts } from '@/hooks/useLlmTasks';

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
  const session = useAuth();
  const providers = [
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
  ];

  const isConfigured = config.llm?.baseUrl && config.llm?.apiKey;
  const isEditing = editingSection === 'llm';

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; models?: string[] } | { ok: false; error: string } | null
  >(null);

  // Available models from /api/llm/available-models — fetched on demand via
  // the "Refresh available models" button. Lets the user click-to-fill the
  // Model input rather than typing the name from memory.
  const [availableModels, setAvailableModels] = useState<string[] | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);

  const { data: defaultPromptsData } = useLlmDefaultPrompts();
  const defaultPrompts = defaultPromptsData?.data;
  // Per-task numeric defaults come back on the saved config response. Used
  // as input placeholders so users see active defaults at a glance.
  const llmTemperatureDefaults = config.llm?.defaults;

  const handleRefreshModels = async () => {
    setRefreshingModels(true);
    try {
      const jwt = typeof window !== 'undefined' ? localStorage.getItem('jwtToken') : null;
      const headers: HeadersInit = {};
      if (jwt) headers.Authorization = `Bearer ${jwt}`;
      const res = await fetch('/api/llm/available-models?refresh=1', { headers });
      const data = await res.json();
      if (data?.success && Array.isArray(data.models)) {
        setAvailableModels(data.models);
        if (data.models.length === 0) {
          toast.info('Provider returned no models');
        }
      } else {
        toast.error(data?.error || 'Failed to fetch models');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally {
      setRefreshingModels(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // Always test the values currently in the form — tempConfig while editing,
      // config otherwise — so the result reflects exactly what the user sees.
      const source = isEditing ? tempConfig.llm : config.llm;
      const body: Record<string, unknown> = {};
      if (source?.provider) body.provider = source.provider;
      if (source?.baseUrl) body.baseUrl = source.baseUrl;
      // Saved apiKey may be masked (****) — only forward what the user typed.
      if (source?.apiKey && !/^\*+$/.test(source.apiKey)) body.apiKey = source.apiKey;
      if (source?.model) body.model = source.model;

      const res = await fetch('/api/llm/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session.data?.user?.apiToken || '',
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data?.success) {
        setTestResult({ ok: true, models: data.models });
        toast.success('LLM connection successful');
      } else {
        const error = data?.error || 'Connection test failed';
        setTestResult({ ok: false, error });
        toast.error(error);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Connection test failed';
      setTestResult({ ok: false, error });
      toast.error(error);
    } finally {
      setTesting(false);
    }
  };

  const canTest = (() => {
    const source = isEditing ? tempConfig.llm : config.llm;
    return !!(source?.baseUrl && source?.apiKey);
  })();

  const llmStatus: 'error' | 'connected' | 'not-configured' =
    testResult && !testResult.ok ? 'error' : isConfigured ? 'connected' : 'not-configured';
  const llmStatusLabel = {
    error: 'Error',
    connected: 'Connected',
    'not-configured': 'Not configured',
  }[llmStatus];
  const llmStatusVariant = {
    error: 'destructive',
    connected: 'success',
    'not-configured': 'outline',
  }[llmStatus] as 'destructive' | 'success' | 'outline';

  // Read the override for a prompt field: tempConfig while editing, saved
  // config otherwise. Keyed by the LLMConfig field name.
  type PromptKey =
    | 'customTestAnalysisSystemPrompt'
    | 'customTestAnalysisInstructions'
    | 'customReportSummaryPrompt'
    | 'customProjectSummarySystemPrompt'
    | 'customProjectSummaryInstructions';
  const getPromptOverride = (key: PromptKey) =>
    isEditing ? tempConfig.llm?.[key] : config.llm?.[key];
  const setPromptOverride = (key: PromptKey) => (next: string | undefined) =>
    onUpdateTempConfig({ llm: { ...tempConfig.llm, [key]: next } });

  return (
    <Card id="llm" className="mb-6 scroll-mt-20 p-4">
      <CardHeader
        className={`flex justify-between items-center flex-row ${editingSection === 'llm' ? 'bg-primary/5 border-l-4 border-primary -mx-4 px-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">LLM Configuration</h2>
          <Badge variant={llmStatusVariant} aria-label={`LLM status: ${llmStatusLabel}`}>
            {llmStatusLabel}
          </Badge>
          {editingSection === 'llm' && (
            <Badge variant="secondary" className="text-xs">
              Editing
            </Badge>
          )}
        </div>
        {editingSection === 'llm' ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!canTest || testing || isUpdating}
              onClick={handleTestConnection}
            >
              {testing ? <Spinner size="sm" /> : <Plug className="h-4 w-4 mr-1" />}
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
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
              <Button
                variant="outline"
                disabled={!canTest || testing}
                onClick={handleTestConnection}
              >
                {testing ? <Spinner size="sm" /> : <Plug className="h-4 w-4 mr-1" />}
                {testing ? 'Testing…' : 'Test Connection'}
              </Button>
            )}
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
        <div className="space-y-6">
          {!isConfigured && (
            <Alert>
              <p className="font-medium mb-2">To enable LLM integration:</p>
              <p className="text-sm text-muted-foreground mb-2">
                Fill in the LLM configuration fields below and save the configuration.
              </p>
              <p className="text-sm text-muted-foreground">
                You can also set environment variables as a fallback: LLM_PROVIDER, LLM_BASE_URL,
                LLM_API_KEY, LLM_MODEL, LLM_TEMPERATURE
              </p>
            </Alert>
          )}
          <section className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Connection
            </h3>
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
                  editingSection === 'llm'
                    ? tempConfig.llm?.baseUrl || ''
                    : config.llm?.baseUrl || ''
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
          </section>

          <section className="space-y-4 border-t pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Model
            </h3>
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
              <div className="flex items-start gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isConfigured || refreshingModels}
                  onClick={handleRefreshModels}
                >
                  {refreshingModels ? (
                    <Spinner size="sm" />
                  ) : (
                    <RefreshCw className="h-3 w-3 mr-1" />
                  )}
                  {refreshingModels ? 'Fetching…' : 'Refresh available models'}
                </Button>
                {availableModels && availableModels.length > 0 && (
                  <div className="flex flex-wrap gap-1 flex-1">
                    {availableModels.map((m) => (
                      <Badge
                        key={m}
                        variant="outline"
                        className={`text-xs font-mono cursor-pointer hover:bg-accent ${editingSection !== 'llm' ? 'opacity-60 cursor-not-allowed' : ''}`}
                        onClick={() => {
                          if (editingSection === 'llm') {
                            onUpdateTempConfig({ llm: { ...tempConfig.llm, model: m } });
                          }
                        }}
                        title={
                          editingSection === 'llm'
                            ? 'Click to use this model'
                            : 'Enter edit mode to pick'
                        }
                      >
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="space-y-4 border-t pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Temperatures
            </h3>
            {/* Per-task temperature. Each task type is set independently; no
              shared default knob. Blank → falls through to the env default
              (LLM_TEMPERATURE, 0.3 if unset). Cooler values (≤0.3) bias
              toward classification accuracy; warmer (≥0.5) bias toward
              varied phrasing. */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Temperature per task (0–2)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    {
                      id: 'llm-temp-test',
                      label: 'Test analysis',
                      key: 'testAnalysisTemperature' as const,
                    },
                    {
                      id: 'llm-temp-report',
                      label: 'Report summary',
                      key: 'reportSummaryTemperature' as const,
                    },
                    {
                      id: 'llm-temp-project',
                      label: 'Project summary',
                      key: 'projectSummaryTemperature' as const,
                    },
                  ] as const
                ).map(({ id, label, key }) => {
                  // Resolved value = explicit override if set, otherwise the
                  // server-side default. Showing the resolved number (not the
                  // word "default") tells the user what's actually in effect.
                  const explicit =
                    editingSection === 'llm' ? tempConfig.llm?.[key] : config.llm?.[key];
                  const fallback = llmTemperatureDefaults?.[key];
                  const resolved = explicit ?? fallback;
                  const isUsingDefault = explicit === undefined;
                  return (
                    <div key={id} className="space-y-1">
                      <Label htmlFor={id} className="text-xs text-muted-foreground">
                        {label}
                      </Label>
                      <Input
                        id={id}
                        disabled={editingSection !== 'llm'}
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={resolved?.toString() ?? ''}
                        onChange={(e) =>
                          editingSection === 'llm' &&
                          onUpdateTempConfig({
                            llm: {
                              ...tempConfig.llm,
                              [key]: e.target.value ? Number.parseFloat(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                      {isUsingDefault && (
                        <p className="text-[10px] text-muted-foreground">
                          Using default — type a value to override.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Clear a field to fall back to the server default. Test analysis usually benefits
                from a cooler value (e.g. 0.2) for category accuracy.
              </p>
            </div>
          </section>

          <section className="space-y-4 border-t pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Limits &amp; Output
            </h3>
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
                      parallelRequests: e.target.value
                        ? Number.parseInt(e.target.value, 10)
                        : undefined,
                    },
                  })
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="llm-max-tokens">Max output tokens (optional)</Label>
                <Input
                  id="llm-max-tokens"
                  disabled={editingSection !== 'llm'}
                  placeholder="leave blank for model default"
                  type="number"
                  min="1"
                  step="1"
                  value={
                    editingSection === 'llm'
                      ? (tempConfig.llm?.maxTokens?.toString() ?? '')
                      : (config.llm?.maxTokens?.toString() ?? '')
                  }
                  onChange={(e) =>
                    editingSection === 'llm' &&
                    onUpdateTempConfig({
                      llm: {
                        ...tempConfig.llm,
                        maxTokens: e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                      },
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Cap on output tokens per request. OpenAI/local servers omit this when blank;
                  Anthropic falls back to a safe default (8000) since its API requires the field.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-context-window">Context window override (optional)</Label>
                <Input
                  id="llm-context-window"
                  disabled={editingSection !== 'llm'}
                  placeholder="auto-detect via /models"
                  type="number"
                  min="1024"
                  step="1024"
                  value={
                    editingSection === 'llm'
                      ? (tempConfig.llm?.contextWindow?.toString() ?? '')
                      : (config.llm?.contextWindow?.toString() ?? '')
                  }
                  onChange={(e) =>
                    editingSection === 'llm' &&
                    onUpdateTempConfig({
                      llm: {
                        ...tempConfig.llm,
                        contextWindow: e.target.value
                          ? Number.parseInt(e.target.value, 10)
                          : undefined,
                      },
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Total tokens the model accepts. Used to right-size the prompt before sending.
                  Leave blank to auto-detect from the provider's /models endpoint.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-multimodal-mode">Multimodal mode</Label>
                <Select
                  disabled={editingSection !== 'llm'}
                  value={
                    editingSection === 'llm'
                      ? (tempConfig.llm?.multimodalMode ?? 'auto')
                      : (config.llm?.multimodalMode ?? 'auto')
                  }
                  onValueChange={(value) =>
                    editingSection === 'llm' &&
                    onUpdateTempConfig({
                      llm: {
                        ...tempConfig.llm,
                        multimodalMode: value as 'auto' | 'force' | 'disabled',
                      },
                    })
                  }
                >
                  <SelectTrigger id="llm-multimodal-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      Auto — attach images, fall back on unsupported
                    </SelectItem>
                    <SelectItem value="force">Force — require image support</SelectItem>
                    <SelectItem value="disabled">Disabled — never attach images</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Whether to attach screenshots for visual failures (snapshot mismatch, element not
                  visible / found). Disable on text-only models to skip the probe.
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4 border-t pt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Automation
            </h3>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium">Auto-analyze new reports</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, every failed test in a newly ingested report is queued for LLM
                  analysis automatically.
                </p>
              </div>
              <Switch
                disabled={editingSection !== 'llm'}
                checked={
                  editingSection === 'llm'
                    ? !!tempConfig.llm?.autoAnalyzeNewReports
                    : !!config.llm?.autoAnalyzeNewReports
                }
                onCheckedChange={(checked) => {
                  if (editingSection === 'llm') {
                    onUpdateTempConfig({
                      llm: { ...tempConfig.llm, autoAnalyzeNewReports: checked },
                    });
                  }
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium">Analyze all-green windows</h4>
                <p className="text-xs text-muted-foreground mt-1">
                  When enabled, "Generate Analysis" runs the LLM even when no failures were observed
                  — surfaces duration creep, near-flakes, quarantine churn, and suite shrinkage. Off
                  by default to keep LLM spend predictable.
                </p>
              </div>
              <Switch
                disabled={editingSection !== 'llm'}
                checked={
                  editingSection === 'llm'
                    ? !!tempConfig.llm?.analyzeGreenWindows
                    : !!config.llm?.analyzeGreenWindows
                }
                onCheckedChange={(checked) => {
                  if (editingSection === 'llm') {
                    onUpdateTempConfig({
                      llm: { ...tempConfig.llm, analyzeGreenWindows: checked },
                    });
                  }
                }}
              />
            </div>
          </section>

          {/* Custom prompts — each textarea is pre-populated with the resolved
              prompt (saved override OR built-in default) so users can edit
              what's already in effect. Saving text identical to the default
              clears the override so future default updates flow through. */}
          <Accordion type="single" collapsible>
            <AccordionItem value="custom-prompts" className="border rounded-md px-3">
              <AccordionTrigger className="text-sm font-medium">
                Custom prompts (advanced)
              </AccordionTrigger>
              <AccordionContent className="space-y-6">
                <p className="text-xs text-muted-foreground">
                  Override the built-in prompt templates for each task. Each field is pre-filled
                  with the prompt currently in effect — edit to override, or click "Reset to
                  default" to roll back. Supports{' '}
                  <code className="text-xs bg-muted px-1 rounded">{'{{var}}'}</code> substitution
                  from a per-template allowlist; unknown vars are left intact and logged.
                </p>

                {/* Test analysis — per-test failure deep-dive. */}
                <div className="space-y-3 rounded-md border p-3">
                  <h4 className="text-sm font-semibold">Test</h4>
                  <CustomPromptField
                    id="llm-custom-test-system"
                    label="System prompt"
                    rows={5}
                    disabled={!isEditing}
                    defaultPrompt={
                      defaultPrompts?.testAnalysisSystemPrompt.content ??
                      defaultPrompts?.systemPrompt.content
                    }
                    override={getPromptOverride('customTestAnalysisSystemPrompt')}
                    helper={<>No vars available.</>}
                    onChange={setPromptOverride('customTestAnalysisSystemPrompt')}
                  />
                  <CustomPromptField
                    id="llm-custom-test"
                    label="Task instructions"
                    rows={12}
                    disabled={!isEditing}
                    defaultPrompt={defaultPrompts?.testAnalysisInstructions.content}
                    override={getPromptOverride('customTestAnalysisInstructions')}
                    helper={
                      <>
                        Vars: <code className="text-xs">{'{{project}}'}</code>,{' '}
                        <code className="text-xs">{'{{testTitle}}'}</code>,{' '}
                        <code className="text-xs">{'{{filePath}}'}</code>,{' '}
                        <code className="text-xs">{'{{errorCategory}}'}</code>
                      </>
                    }
                    onChange={setPromptOverride('customTestAnalysisInstructions')}
                  />
                </div>

                {/* Report summary — one-run aggregation across per-test analyses. */}
                <div className="space-y-3 rounded-md border p-3">
                  <h4 className="text-sm font-semibold">Report</h4>
                  <CustomPromptField
                    id="llm-custom-report"
                    label="Prompt"
                    rows={14}
                    disabled={!isEditing}
                    defaultPrompt={defaultPrompts?.reportSummaryPrompt.content}
                    override={getPromptOverride('customReportSummaryPrompt')}
                    helper={
                      <>
                        Vars: <code className="text-xs">{'{{reportId}}'}</code>,{' '}
                        <code className="text-xs">{'{{project}}'}</code>,{' '}
                        <code className="text-xs">{'{{totalFailures}}'}</code>
                      </>
                    }
                    onChange={setPromptOverride('customReportSummaryPrompt')}
                  />
                </div>

                {/* Project summary — health roll-up across the latest N runs. */}
                <div className="space-y-3 rounded-md border p-3">
                  <h4 className="text-sm font-semibold">Project</h4>
                  <CustomPromptField
                    id="llm-custom-project-system"
                    label="System prompt"
                    rows={5}
                    disabled={!isEditing}
                    defaultPrompt={
                      defaultPrompts?.projectSummarySystemPrompt.content ??
                      defaultPrompts?.systemPrompt.content
                    }
                    override={getPromptOverride('customProjectSummarySystemPrompt')}
                    helper={<>No vars available.</>}
                    onChange={setPromptOverride('customProjectSummarySystemPrompt')}
                  />
                  <CustomPromptField
                    id="llm-custom-project"
                    label="Task instructions"
                    rows={12}
                    disabled={!isEditing}
                    defaultPrompt={defaultPrompts?.projectSummaryInstructions.content}
                    override={getPromptOverride('customProjectSummaryInstructions')}
                    helper={
                      <>
                        Vars: <code className="text-xs">{'{{project}}'}</code>,{' '}
                        <code className="text-xs">{'{{totalRuns}}'}</code>,{' '}
                        <code className="text-xs">{'{{passingRuns}}'}</code>
                      </>
                    }
                    onChange={setPromptOverride('customProjectSummaryInstructions')}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {testResult && (
            <Alert
              className={
                testResult.ok ? 'border-success/50 bg-success-50' : 'border-danger/50 bg-danger-50'
              }
            >
              <div className="flex items-start gap-2">
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-success mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 text-danger mt-0.5" />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {testResult.ok ? 'Connection successful' : 'Connection failed'}
                  </p>
                  {testResult.ok && testResult.models && testResult.models.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {testResult.models.length} model{testResult.models.length === 1 ? '' : 's'}{' '}
                      available
                      {testResult.models.length <= 5 ? `: ${testResult.models.join(', ')}` : ''}
                    </p>
                  )}
                  {!testResult.ok && (
                    <p className="text-xs text-muted-foreground mt-1 break-words">
                      {testResult.error}
                    </p>
                  )}
                </div>
              </div>
            </Alert>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface CustomPromptFieldProps {
  id: string;
  label: string;
  rows: number;
  disabled: boolean;
  defaultPrompt: string | undefined;
  override: string | undefined;
  helper: React.ReactNode;
  onChange: (next: string | undefined) => void;
}

function CustomPromptField({
  id,
  label,
  rows,
  disabled,
  defaultPrompt,
  override,
  helper,
  onChange,
}: CustomPromptFieldProps) {
  const resolved = override ?? defaultPrompt ?? '';
  // Override is "active" only when it differs from the default. Editing back to
  // the default is treated as a reset so future default updates flow through.
  const isCustom = override !== undefined && override !== '' && override !== defaultPrompt;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        {!disabled && isCustom && (
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => onChange(undefined)}
          >
            Reset to default
          </button>
        )}
      </div>
      <Textarea
        id={id}
        disabled={disabled}
        rows={rows}
        value={resolved}
        onChange={(e) => {
          const next = e.target.value;
          onChange(next === defaultPrompt || next === '' ? undefined : next);
        }}
      />
      <p className="text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}
