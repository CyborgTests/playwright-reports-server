import type { LLMConfig, LLMProviderType, ServerConfig } from '@playwright-reports/shared';
import { PROMPT_VARIABLES } from '@playwright-reports/shared';
import { CheckCircle2, ListTodo, Plug, RefreshCw, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { useLlmAvailableModels, useLlmConnectionTest } from '@/hooks/useLlmConnection';
import { useLlmDefaultPrompts } from '@/hooks/useLlmTasks';
import type { EditableSettingsSection } from '../types';
import { CustomPromptField } from './CustomPromptField';

interface LLMConfigurationProps {
  config: ServerConfig;
  tempConfig: ServerConfig;
  editingSection: EditableSettingsSection;
  isUpdating: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onUpdateTempConfig: (updates: Partial<ServerConfig>) => void;
}

const PROVIDERS: ReadonlyArray<{ key: LLMProviderType; label: string }> = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
];

const TEMPERATURE_FIELDS = [
  { id: 'llm-temp-test', label: 'Test analysis', key: 'testAnalysisTemperature' },
  { id: 'llm-temp-report', label: 'Report summary', key: 'reportSummaryTemperature' },
  { id: 'llm-temp-project', label: 'Project summary', key: 'projectSummaryTemperature' },
] as const;

const AUTOMATION_TOGGLES = [
  {
    key: 'autoAnalyzeNewReports',
    title: 'Auto-analyze new reports',
    description:
      'When enabled, every failed test in a newly ingested report is queued for LLM analysis automatically.',
  },
  {
    key: 'autoProjectSummaryOnReportComplete',
    title: 'Auto-generate project summary',
    description:
      'When enabled, completing a report\'s failure analysis automatically queues a project-level summary for that project and for "all" projects.',
  },
  {
    key: 'analyzeGreenWindows',
    title: 'Analyze all-green windows',
    description:
      'When enabled, "Generate Analysis" runs the LLM even when no failures were observed — surfaces duration creep, near-flakes, quarantine churn, and suite shrinkage. Off by default to keep LLM spend predictable.',
  },
] as const;

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

  const isConfigured = !!config.llm?.baseUrl;
  const isEditing = editingSection === 'llm';

  const draft = isEditing ? tempConfig.llm : config.llm;
  const updateLlm = (updates: Partial<LLMConfig>) => {
    if (isEditing) onUpdateTempConfig({ llm: { ...tempConfig.llm, ...updates } });
  };
  const setLlmField = <K extends keyof LLMConfig>(key: K, value: LLMConfig[K]) => {
    if (isEditing) onUpdateTempConfig({ llm: { ...tempConfig.llm, [key]: value } });
  };

  const { testing, testResult, test, clearResult } = useLlmConnectionTest();
  const {
    availableModels,
    refreshing: refreshingModels,
    refresh: handleRefreshModels,
  } = useLlmAvailableModels();

  const [contextAccordionValue, setContextAccordionValue] = useState<string>('');
  const [promptsAccordionValue, setPromptsAccordionValue] = useState<string>('');
  const promptsAccordionOpen = promptsAccordionValue === 'custom-prompts';
  const { data: defaultPromptsData } = useLlmDefaultPrompts({
    enabled: promptsAccordionOpen,
  });
  const defaultPrompts = defaultPromptsData?.data;
  const llmTemperatureDefaults = config.llm?.defaults;

  const canTest = !!draft?.baseUrl;

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

  type PromptKey =
    | 'customTestAnalysisSystemPrompt'
    | 'customTestAnalysisInstructions'
    | 'customReportSummaryPrompt'
    | 'customProjectSummarySystemPrompt'
    | 'customProjectSummaryInstructions';
  const getPromptOverride = (key: PromptKey) => draft?.[key];
  const setPromptOverride = (key: PromptKey) => (next: string | undefined) =>
    setLlmField(key, next);

  return (
    <Card id="llm" className="mb-6 scroll-mt-20 p-4">
      <CardHeader
        className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${isEditing ? 'bg-primary/5 border-l-4 border-primary -mx-4 px-4' : ''}`}
      >
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">LLM Configuration</h2>
          <Badge variant={llmStatusVariant} aria-label={`LLM status: ${llmStatusLabel}`}>
            {llmStatusLabel}
          </Badge>
          {isEditing && (
            <Badge variant="secondary" className="text-xs">
              Editing
            </Badge>
          )}
        </div>
        {isEditing ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canTest || testing || isUpdating}
              onClick={() => test(draft, isEditing)}
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
          <div className="flex flex-wrap gap-2">
            {isConfigured && (
              <Button
                variant="outline"
                disabled={!canTest || testing}
                onClick={() => test(draft, isEditing)}
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
              {editingSection === 'none' ? 'Edit Configuration' : 'Editing other section'}
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
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
                <button
                  type="button"
                  onClick={clearResult}
                  aria-label="Dismiss connection test result"
                  className="text-muted-foreground hover:text-foreground transition-colors -mt-0.5 -mr-1 p-1 rounded"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Alert>
          )}
          {!isConfigured && (
            <Alert>
              <p className="font-medium mb-2">To enable LLM integration:</p>
              <p className="text-sm text-muted-foreground">
                Fill in the LLM configuration fields below and save the configuration.
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
                disabled={!isEditing}
                value={draft?.provider || ''}
                onValueChange={(value) => updateLlm({ provider: value as LLMProviderType })}
              >
                <SelectTrigger id="llm-provider">
                  <SelectValue placeholder="Select LLM provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((provider) => (
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
                disabled={!isEditing}
                placeholder="https://api.openai.com/v1"
                value={draft?.baseUrl || ''}
                onChange={(e) => updateLlm({ baseUrl: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="llm-api-key">API Key</Label>
              <Input
                id="llm-api-key"
                disabled={!isEditing}
                placeholder="Leave blank for local servers (LM Studio, Ollama, vLLM…)"
                type="password"
                value={draft?.apiKey || ''}
                onChange={(e) => updateLlm({ apiKey: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Required for hosted providers (OpenAI, Anthropic, OpenRouter). Local OpenAI-
                compatible servers usually don't need one unless you set it.
              </p>
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
                disabled={!isEditing}
                placeholder="gpt-4, claude-3-sonnet, etc."
                value={draft?.model || ''}
                onChange={(e) => updateLlm({ model: e.target.value })}
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
                        className={`text-xs font-mono cursor-pointer hover:bg-accent ${!isEditing ? 'opacity-60 cursor-not-allowed' : ''}`}
                        onClick={() => updateLlm({ model: m })}
                        title={isEditing ? 'Click to use this model' : 'Enter edit mode to pick'}
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
            <div className="space-y-2">
              <Label className="text-sm font-medium">Temperature per task (0–2)</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TEMPERATURE_FIELDS.map(({ id, label, key }) => {
                  // Resolved value = explicit override if set, otherwise the
                  // server-side default. Showing the resolved number (not the
                  // word "default") tells the user what's actually in effect.
                  const explicit = draft?.[key];
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
                        disabled={!isEditing}
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={resolved?.toString() ?? ''}
                        onChange={(e) =>
                          setLlmField(
                            key,
                            e.target.value ? Number.parseFloat(e.target.value) : undefined
                          )
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
                disabled={!isEditing}
                placeholder="1"
                type="number"
                min="1"
                max="10"
                step="1"
                value={draft?.parallelRequests?.toString() || ''}
                onChange={(e) =>
                  updateLlm({
                    parallelRequests: e.target.value
                      ? Number.parseInt(e.target.value, 10)
                      : undefined,
                  })
                }
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="llm-max-tokens">Max output tokens (optional)</Label>
                <Input
                  id="llm-max-tokens"
                  disabled={!isEditing}
                  placeholder="leave blank for model default"
                  type="number"
                  min="1"
                  step="1"
                  value={draft?.maxTokens?.toString() ?? ''}
                  onChange={(e) =>
                    updateLlm({
                      maxTokens: e.target.value ? Number.parseInt(e.target.value, 10) : undefined,
                    })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Cap on output tokens per request. OpenAI/local servers omit this when blank;
                  Anthropic falls back to a safe default (8000) since its API requires the field.
                  Openrouter providers sometimes get into looped inference and produce 65k tokens.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="llm-context-window">Context window override (optional)</Label>
                <Input
                  id="llm-context-window"
                  disabled={!isEditing}
                  placeholder="auto-detect via /models"
                  type="number"
                  min="1024"
                  step="1024"
                  value={draft?.contextWindow?.toString() ?? ''}
                  onChange={(e) =>
                    updateLlm({
                      contextWindow: e.target.value
                        ? Number.parseInt(e.target.value, 10)
                        : undefined,
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
                  disabled={!isEditing}
                  value={draft?.multimodalMode ?? 'auto'}
                  onValueChange={(value) =>
                    updateLlm({ multimodalMode: value as 'auto' | 'force' | 'disabled' })
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
            {AUTOMATION_TOGGLES.map(({ key, title, description }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium">{title}</h4>
                  <p className="text-xs text-muted-foreground mt-1">{description}</p>
                </div>
                <Switch
                  disabled={!isEditing}
                  checked={!!draft?.[key]}
                  onCheckedChange={(checked) => setLlmField(key, checked)}
                />
              </div>
            ))}
          </section>

          <Accordion
            type="single"
            collapsible
            value={contextAccordionValue}
            onValueChange={setContextAccordionValue}
          >
            <AccordionItem value="project-context" className="border rounded-md px-3">
              <AccordionTrigger className="text-sm font-medium">Project context</AccordionTrigger>
              <AccordionContent className="space-y-2">
                <Label htmlFor="llm-general-context">General context (optional)</Label>
                <Textarea
                  id="llm-general-context"
                  disabled={!isEditing}
                  rows={4}
                  maxLength={500}
                  placeholder="Describe the project, its stack, environment specifics, or anything that would help interpret failures."
                  value={draft?.generalContext ?? ''}
                  onChange={(e) => updateLlm({ generalContext: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Shared with every LLM analysis. Max 500 characters
                  {isEditing ? ` (${(tempConfig.llm?.generalContext ?? '').length}/500).` : '.'}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {/* Custom prompts — each textarea is pre-populated with the resolved
              prompt (saved override OR built-in default) so users can edit
              what's already in effect. Saving text identical to the default
              clears the override so future default updates flow through. */}
          <Accordion
            type="single"
            collapsible
            value={promptsAccordionValue}
            onValueChange={setPromptsAccordionValue}
          >
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
                    variables={PROMPT_VARIABLES.customTestAnalysisSystemPrompt}
                    onChange={setPromptOverride('customTestAnalysisSystemPrompt')}
                  />
                  <CustomPromptField
                    id="llm-custom-test"
                    label="Task instructions"
                    rows={12}
                    disabled={!isEditing}
                    defaultPrompt={defaultPrompts?.testAnalysisInstructions.content}
                    override={getPromptOverride('customTestAnalysisInstructions')}
                    helper={<>Type {'{{'} for variable suggestions.</>}
                    variables={PROMPT_VARIABLES.customTestAnalysisInstructions}
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
                    helper={<>Type {'{{'} for variable suggestions.</>}
                    variables={PROMPT_VARIABLES.customReportSummaryPrompt}
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
                    variables={PROMPT_VARIABLES.customProjectSummarySystemPrompt}
                    onChange={setPromptOverride('customProjectSummarySystemPrompt')}
                  />
                  <CustomPromptField
                    id="llm-custom-project"
                    label="Task instructions"
                    rows={12}
                    disabled={!isEditing}
                    defaultPrompt={defaultPrompts?.projectSummaryInstructions.content}
                    override={getPromptOverride('customProjectSummaryInstructions')}
                    helper={<>Type {'{{'} for variable suggestions.</>}
                    variables={PROMPT_VARIABLES.customProjectSummaryInstructions}
                    onChange={setPromptOverride('customProjectSummaryInstructions')}
                  />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </CardContent>
    </Card>
  );
}
