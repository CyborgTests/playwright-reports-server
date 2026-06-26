import type {
  LlmRoleRef,
  LlmStrategy,
  LlmTaskRouting,
  LlmTaskType,
} from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useLlmModels } from '@/hooks/useLlmModels';
import useMutation from '@/hooks/useMutation';
import { SERVER_CONFIG_KEY, useServerConfig } from '@/hooks/useServerConfig';
import {
  cleanRouting,
  diversityWarning,
  type RoleListKey,
  type RoleSingleKey,
  type RoutingControls,
  type RoutingMap,
  SCREENSHOT_OFF,
  type ScreenshotCfg,
  TASKS,
  TRACE_SOURCES,
} from './routing-helpers';
import { PRIMARY } from './routing-role-pickers';
import { TaskRoutingCard } from './routing-task-card';

export default function LLMRoutingConfiguration({
  featureEnabled,
}: Readonly<{ featureEnabled: boolean }>) {
  const queryClient = useQueryClient();
  const { data: config } = useServerConfig();
  const { data: allModels } = useLlmModels();
  const models = useMemo(() => (allModels ?? []).filter((m) => m.enabled), [allModels]);
  const modelIds = useMemo(
    () => (allModels ? new Set(models.map((m) => m.id)) : undefined),
    [allModels, models]
  );
  const primaryId = useMemo(() => (allModels ?? []).find((m) => m.isPrimary)?.id, [allModels]);
  const [routing, setRouting] = useState<RoutingMap>({});
  const [savedRouting, setSavedRouting] = useState<RoutingMap>({});
  const emptyShot: ScreenshotCfg = {
    sources: ['attachment'],
    max: '',
    modelId: '',
  };
  const [screenshot, setScreenshot] = useState<ScreenshotCfg>(emptyShot);
  const [savedScreenshot, setSavedScreenshot] = useState<ScreenshotCfg>(emptyShot);

  const dirty =
    JSON.stringify(cleanRouting(routing, modelIds)) !==
      JSON.stringify(cleanRouting(savedRouting, modelIds)) ||
    JSON.stringify(screenshot) !== JSON.stringify(savedScreenshot);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !config) return;
    seeded.current = true;
    const loaded = config.llm?.routing ?? {};
    setRouting(loaded);
    setSavedRouting(loaded);
    const shot: ScreenshotCfg = {
      sources: config.llm?.screenshotSources ?? ['attachment'],
      max: config.llm?.maxScreenshots != null ? String(config.llm.maxScreenshots) : '',
      modelId: config.llm?.screenshotModel?.modelId ?? '',
    };
    setScreenshot(shot);
    setSavedScreenshot(shot);
  }, [config]);

  const screenshotValue =
    screenshot.modelId && models.some((m) => m.id === screenshot.modelId)
      ? screenshot.modelId
      : SCREENSHOT_OFF;

  const taskRouting = (task: LlmTaskType): LlmTaskRouting =>
    routing[task] ?? { strategy: 'one_shot' };

  const patchTask = (task: LlmTaskType, patch: Partial<LlmTaskRouting>) => {
    setRouting((prev) => ({
      ...prev,
      [task]: { ...(prev[task] ?? { strategy: 'one_shot' }), ...patch },
    }));
  };

  const setStrategy = (task: LlmTaskType, strategy: LlmStrategy) => {
    setRouting((prev) => ({ ...prev, [task]: { strategy } }));
  };

  const setList = (task: LlmTaskType, key: RoleListKey, next: LlmRoleRef[]) => {
    patchTask(task, { [key]: next.length > 0 ? next : undefined });
  };

  const setSingle = (task: LlmTaskType, key: RoleSingleKey, value: string) => {
    patchTask(task, { [key]: value === PRIMARY ? undefined : { modelId: value } });
  };

  const singleValue = (task: LlmTaskType, key: RoleSingleKey): string => {
    const id = (taskRouting(task)[key] as LlmRoleRef | undefined)?.modelId;
    if (!id || (modelIds && !modelIds.has(id))) return PRIMARY;
    return id;
  };

  const firstAuthorValue = (task: LlmTaskType): string => {
    const id = taskRouting(task).authors?.[0]?.modelId;
    if (!id || (modelIds && !modelIds.has(id))) return PRIMARY;
    return id;
  };
  const setFirstAuthor = (task: LlmTaskType, value: string) =>
    setList(task, 'authors', value === PRIMARY ? [] : [{ modelId: value }]);

  const listFor = (task: LlmTaskType, key: RoleListKey): LlmRoleRef[] => {
    const list = (taskRouting(task)[key] as LlmRoleRef[] | undefined) ?? [];
    return modelIds ? list.filter((r) => r.modelId !== undefined && modelIds.has(r.modelId)) : list;
  };

  const controlsFor = (task: LlmTaskType): RoutingControls => ({
    setStrategy: (strategy) => setStrategy(task, strategy),
    singleValue: (key) => singleValue(task, key),
    setSingle: (key, value) => setSingle(task, key, value),
    listFor: (key) => listFor(task, key),
    setList: (key, next) => setList(task, key, next),
    patch: (patch) => patchTask(task, patch),
    firstAuthorValue: () => firstAuthorValue(task),
    setFirstAuthor: (value) => setFirstAuthor(task, value),
  });

  const mutation = useMutation('/api/config', {
    method: 'PATCH',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [SERVER_CONFIG_KEY] });
      setSavedRouting(routing);
      setSavedScreenshot(screenshot);
      toast.success('Routing configuration saved');
    },
  });

  const save = () => {
    const formData = new FormData();
    formData.append('llmRouting', JSON.stringify(cleanRouting(routing, modelIds)));
    formData.append(
      'llmScreenshotModel',
      screenshotValue === SCREENSHOT_OFF ? '' : screenshotValue
    );
    formData.append('llmScreenshotSources', screenshot.sources.join(','));
    const usesTrace = screenshot.sources.some((s) => TRACE_SOURCES.includes(s));
    formData.append('llmMaxScreenshots', usesTrace ? screenshot.max : '');
    mutation.mutate({ body: formData });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold">Routing</h3>
        {dirty && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRouting(savedRouting);
                setScreenshot(savedScreenshot);
              }}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save routing'}
            </Button>
          </div>
        )}
      </div>
      <div className={featureEnabled ? '' : 'opacity-50'}>
        <p className="text-sm text-muted-foreground mb-4">
          Choose how each task is produced. Various strategies can allow orchestrate several models.
          They only pay off with genuinely <span className="font-medium">different</span>
          (or stronger) models, not the same model repeated.
        </p>

        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add and enable at least one model above to configure routing.
          </p>
        ) : (
          <div className="space-y-5">
            {TASKS.map((t) => {
              const cfg = taskRouting(t.key);
              return (
                <TaskRoutingCard
                  key={t.key}
                  label={t.label}
                  cfg={cfg}
                  models={models}
                  warning={diversityWarning(cfg, primaryId)}
                  controls={controlsFor(t.key)}
                  screenshot={
                    t.key === 'test_analysis'
                      ? { cfg: screenshot, value: screenshotValue, onChange: setScreenshot }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
