import type { PromptVariable } from '@playwright-reports/shared';
import { PROMPT_VARIABLES } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useLlmDefaultPrompts } from '@/hooks/useLlmTasks';
import useMutation from '@/hooks/useMutation';
import { SERVER_CONFIG_KEY, useServerConfig } from '@/hooks/useServerConfig';
import { CustomPromptField } from './CustomPromptField';

type PromptKey =
  | 'customTestAnalysisSystemPrompt'
  | 'customTestAnalysisInstructions'
  | 'customReportSummaryPrompt'
  | 'customProjectSummarySystemPrompt'
  | 'customProjectSummaryInstructions'
  | 'customSynthesizerPrompt'
  | 'customJudgePrompt'
  | 'customCritiquePrompt'
  | 'customRevisePrompt'
  | 'customScorerPrompt';

const FIELD_NAME: Record<PromptKey, string> = {
  customTestAnalysisSystemPrompt: 'llmCustomTestAnalysisSystemPrompt',
  customTestAnalysisInstructions: 'llmCustomTestAnalysisInstructions',
  customReportSummaryPrompt: 'llmCustomReportSummaryPrompt',
  customProjectSummarySystemPrompt: 'llmCustomProjectSummarySystemPrompt',
  customProjectSummaryInstructions: 'llmCustomProjectSummaryInstructions',
  customSynthesizerPrompt: 'llmCustomSynthesizerPrompt',
  customJudgePrompt: 'llmCustomJudgePrompt',
  customCritiquePrompt: 'llmCustomCritiquePrompt',
  customRevisePrompt: 'llmCustomRevisePrompt',
  customScorerPrompt: 'llmCustomScorerPrompt',
};

const PROMPT_KEYS = Object.keys(FIELD_NAME) as PromptKey[];

type Overrides = Partial<Record<PromptKey, string>>;

interface PromptState {
  generalContext: string;
  overrides: Overrides;
}

function snapshotKey(s: PromptState): string {
  return JSON.stringify({ g: s.generalContext, o: s.overrides });
}

export default function LLMPromptsSection() {
  const queryClient = useQueryClient();
  const { data: config } = useServerConfig();
  const [state, setState] = useState<PromptState>({ generalContext: '', overrides: {} });
  const [saved, setSaved] = useState<PromptState>({ generalContext: '', overrides: {} });
  const { data: defaultPromptsData } = useLlmDefaultPrompts({ enabled: true });
  const defaults = defaultPromptsData?.data;

  const dirty = snapshotKey(state) !== snapshotKey(saved);

  const seeded = useRef(false);
  useEffect(() => {
    const llm = config?.llm;
    if (seeded.current || !llm) return;
    seeded.current = true;
    const overrides: Overrides = {};
    for (const key of PROMPT_KEYS) {
      const v = llm[key];
      if (typeof v === 'string' && v.length > 0) overrides[key] = v;
    }
    const next: PromptState = { generalContext: llm.generalContext ?? '', overrides };
    setState(next);
    setSaved(next);
  }, [config]);

  const setOverride = (key: PromptKey) => (next: string | undefined) =>
    setState((prev) => {
      const overrides = { ...prev.overrides };
      if (next === undefined || next === '') delete overrides[key];
      else overrides[key] = next;
      return { ...prev, overrides };
    });

  const mutation = useMutation('/api/config', {
    method: 'PATCH',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SERVER_CONFIG_KEY] });
      toast.success('Prompts saved');
      setSaved(state);
    },
  });

  const save = () => {
    const formData = new FormData();
    formData.append('llmGeneralContext', state.generalContext);
    for (const key of PROMPT_KEYS) formData.append(FIELD_NAME[key], state.overrides[key] ?? '');
    mutation.mutate({ body: formData });
  };

  const field = (
    key: PromptKey,
    label: string,
    rows: number,
    defaultPrompt: string | undefined,
    variables: readonly PromptVariable[] = []
  ) => (
    <CustomPromptField
      id={`llm-${key}`}
      label={label}
      rows={rows}
      disabled={false}
      defaultPrompt={defaultPrompt}
      override={state.overrides[key]}
      helper={
        variables.length ? <>Type {'{{'} for variable suggestions.</> : <>No vars available.</>
      }
      variables={variables}
      onChange={setOverride(key)}
    />
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">Prompts</h3>
        {dirty && (
          <Button onClick={save} disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save prompts'}
          </Button>
        )}
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="context" className="border rounded-md px-3">
          <AccordionTrigger className="text-sm font-medium">Project context</AccordionTrigger>
          <AccordionContent className="space-y-2">
            <Label htmlFor="llm-general-context">General context (optional)</Label>
            <Textarea
              id="llm-general-context"
              rows={4}
              maxLength={500}
              placeholder="Describe the project, its stack, environment specifics, or anything that helps interpret failures."
              value={state.generalContext}
              onChange={(e) => setState((p) => ({ ...p, generalContext: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Shared with every LLM analysis. Max 500 characters ({state.generalContext.length}
              /500).
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="task-prompts" className="border rounded-md px-3 mt-2">
          <AccordionTrigger className="text-sm font-medium">Task prompts</AccordionTrigger>
          <AccordionContent className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Override the built-in templates per task. Each field is pre-filled with the prompt in
              effect - edit to override, or reset to roll back.
            </p>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Test</h4>
              {field(
                'customTestAnalysisSystemPrompt',
                'System prompt',
                5,
                defaults?.testAnalysisSystemPrompt.content ?? defaults?.systemPrompt.content,
                PROMPT_VARIABLES.customTestAnalysisSystemPrompt
              )}
              {field(
                'customTestAnalysisInstructions',
                'Task instructions',
                12,
                defaults?.testAnalysisInstructions.content,
                PROMPT_VARIABLES.customTestAnalysisInstructions
              )}
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Report</h4>
              {field(
                'customReportSummaryPrompt',
                'Prompt',
                14,
                defaults?.reportSummaryPrompt.content,
                PROMPT_VARIABLES.customReportSummaryPrompt
              )}
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Project</h4>
              {field(
                'customProjectSummarySystemPrompt',
                'System prompt',
                5,
                defaults?.projectSummarySystemPrompt.content ?? defaults?.systemPrompt.content,
                PROMPT_VARIABLES.customProjectSummarySystemPrompt
              )}
              {field(
                'customProjectSummaryInstructions',
                'Task instructions',
                12,
                defaults?.projectSummaryInstructions.content,
                PROMPT_VARIABLES.customProjectSummaryInstructions
              )}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="strategy-prompts" className="border rounded-md px-3 mt-2">
          <AccordionTrigger className="text-sm font-medium">Routing role prompts</AccordionTrigger>
          <AccordionContent className="space-y-6">
            <p className="text-xs text-muted-foreground">
              Directives used by the multi-model routing strategies. They're appended to the task's
              own prompt, so leave the output format to the task templates above.
            </p>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Fusion · synthesizer</h4>
              {field(
                'customSynthesizerPrompt',
                'Directive',
                6,
                defaults?.synthesizerDirective.content
              )}
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Council · judge</h4>
              {field('customJudgePrompt', 'Directive', 6, defaults?.judgeDirective.content)}
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Refine · critic &amp; reviser</h4>
              {field(
                'customCritiquePrompt',
                'Critique directive',
                5,
                defaults?.critiqueDirective.content
              )}
              {field(
                'customRevisePrompt',
                'Revise directive',
                5,
                defaults?.reviseDirective.content
              )}
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <h4 className="text-sm font-semibold">Cascade · scorer</h4>
              {field('customScorerPrompt', 'Directive', 5, defaults?.scorerDirective.content)}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
