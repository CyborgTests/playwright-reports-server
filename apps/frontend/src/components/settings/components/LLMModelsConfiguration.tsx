import type { LlmModel } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { LLM_MODELS_PATH, useLlmModels } from '@/hooks/useLlmModels';
import useMutation from '@/hooks/useMutation';
import { SERVER_CONFIG_KEY, useServerConfig } from '@/hooks/useServerConfig';
import { errMessage } from '@/lib/api';
import { LLMModelFormDialog } from './LLMModelFormDialog';
import { LLMModelRow } from './LLMModelRow';
import {
  blankForm,
  type FormState,
  parseCost,
  parsePositiveInt,
  parseTemperature,
} from './llm-model-form';

export default function LLMModelsConfiguration({
  featureEnabled,
}: Readonly<{ featureEnabled: boolean }>) {
  const queryClient = useQueryClient();
  const { data: modelsData, isLoading } = useLlmModels();
  const models = modelsData ?? [];
  const { data: config } = useServerConfig();

  const [useFallbackChain, setUseFallbackChain] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LlmModel | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (config?.llm) setUseFallbackChain(!!config.llm.useFallbackChain);
  }, [config]);

  const invalidateModels = () => queryClient.invalidateQueries({ queryKey: [LLM_MODELS_PATH] });
  const createModel = useMutation<LlmModel, Record<string, unknown>>(LLM_MODELS_PATH, {
    method: 'POST',
    silent: true,
    onSuccess: invalidateModels,
  });
  const updateModel = useMutation<LlmModel, Record<string, unknown>>(LLM_MODELS_PATH, {
    method: 'PATCH',
    silent: true,
    onSuccess: invalidateModels,
  });
  const deleteModel = useMutation(LLM_MODELS_PATH, {
    method: 'DELETE',
    silent: true,
    onSuccess: invalidateModels,
  });
  const testConn = useMutation<{ success: boolean; error?: string; models?: string[] }>(
    LLM_MODELS_PATH,
    { method: 'POST', silent: true, onSuccess: invalidateModels }
  );
  const setPrimaryMut = useMutation(LLM_MODELS_PATH, {
    method: 'PATCH',
    silent: true,
    onSuccess: invalidateModels,
  });
  const duplicateMut = useMutation<LlmModel>(LLM_MODELS_PATH, {
    method: 'POST',
    silent: true,
    onSuccess: invalidateModels,
  });
  const reorderMut = useMutation<LlmModel[], { orderedIds: string[] }>(`${LLM_MODELS_PATH}/order`, {
    method: 'PUT',
    silent: true,
    onSuccess: invalidateModels,
  });
  const fallbackMut = useMutation('/api/config', {
    method: 'PATCH',
    silent: true,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [SERVER_CONFIG_KEY] }),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(blankForm);
    setFormOpen(true);
  };

  const openEdit = (m: LlmModel) => {
    setEditingId(m.id);
    setForm({
      label: m.label,
      provider: m.provider,
      baseUrl: m.baseUrl,
      apiKey: '',
      model: m.model,
      parallelRequests: m.parallelRequests,
      maxTokens: m.maxTokens != null ? String(m.maxTokens) : '',
      contextWindow: m.contextWindow != null ? String(m.contextWindow) : '',
      multimodalMode: m.multimodalMode,
      testAnalysisTemperature:
        m.testAnalysisTemperature != null ? String(m.testAnalysisTemperature) : '',
      reportSummaryTemperature:
        m.reportSummaryTemperature != null ? String(m.reportSummaryTemperature) : '',
      projectSummaryTemperature:
        m.projectSummaryTemperature != null ? String(m.projectSummaryTemperature) : '',
      inputCostPerMTok: m.inputCostPerMTok != null ? String(m.inputCostPerMTok) : '',
      outputCostPerMTok: m.outputCostPerMTok != null ? String(m.outputCostPerMTok) : '',
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.label.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      toast.error('Label, base URL and model are required');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        label: form.label.trim(),
        provider: form.provider,
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        parallelRequests: form.parallelRequests,
        maxTokens: parsePositiveInt(form.maxTokens),
        contextWindow: parsePositiveInt(form.contextWindow),
        multimodalMode: form.multimodalMode,
        testAnalysisTemperature: parseTemperature(form.testAnalysisTemperature),
        reportSummaryTemperature: parseTemperature(form.reportSummaryTemperature),
        projectSummaryTemperature: parseTemperature(form.projectSummaryTemperature),
        inputCostPerMTok: parseCost(form.inputCostPerMTok),
        outputCostPerMTok: parseCost(form.outputCostPerMTok),
      };
      if (form.apiKey !== '') payload.apiKey = form.apiKey;

      if (editingId) {
        await updateModel.mutateAsync({ path: `${LLM_MODELS_PATH}/${editingId}`, body: payload });
        toast.success('Model updated');
      } else {
        await createModel.mutateAsync({ body: payload });
        toast.success('Model created - test the connection, then enable it');
      }
      setFormOpen(false);
    } catch (err) {
      toast.error(`Save failed: ${errMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (m: LlmModel) => {
    setBusyId(m.id);
    try {
      const result = await testConn.mutateAsync({
        path: `${LLM_MODELS_PATH}/${m.id}/test-connection`,
      });
      if (result.success) toast.success(`"${m.label}" connected`);
      else toast.error(`Connection failed: ${result.error ?? 'unknown error'}`);
    } catch (err) {
      toast.error(`Test failed: ${errMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (m: LlmModel) => {
    try {
      await updateModel.mutateAsync({
        path: `${LLM_MODELS_PATH}/${m.id}`,
        body: { enabled: !m.enabled },
      });
    } catch (err) {
      toast.error(`Failed: ${errMessage(err)}`);
    }
  };

  const setPrimary = async (m: LlmModel) => {
    setBusyId(m.id);
    try {
      await setPrimaryMut.mutateAsync({ path: `${LLM_MODELS_PATH}/${m.id}/primary` });
      toast.success(`"${m.label}" is now the primary model`);
    } catch (err) {
      toast.error(`Failed: ${errMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (m: LlmModel) => {
    setBusyId(m.id);
    try {
      const copy = await duplicateMut.mutateAsync({ path: `${LLM_MODELS_PATH}/${m.id}/duplicate` });
      openEdit(copy);
    } catch (err) {
      toast.error(`Duplicate failed: ${errMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const move = async (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= models.length) return;
    const reordered = [...models];
    [reordered[idx], reordered[target]] = [reordered[target], reordered[idx]];
    try {
      await reorderMut.mutateAsync({ body: { orderedIds: reordered.map((m) => m.id) } });
    } catch (err) {
      toast.error(`Reorder failed: ${errMessage(err)}`);
    }
  };

  const toggleFallback = async (next: boolean) => {
    setUseFallbackChain(next); // optimistic
    const fd = new FormData();
    fd.append('llmUseFallbackChain', String(next));
    try {
      await fallbackMut.mutateAsync({ body: fd });
    } catch (err) {
      setUseFallbackChain(!next);
      toast.error(`Failed to update fallback setting: ${errMessage(err)}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteModel.mutateAsync({ path: `${LLM_MODELS_PATH}/${deleteTarget.id}` });
      toast.success('Model deleted');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(`Delete failed: ${errMessage(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">Models</h3>
          <Badge variant="outline" className="text-xs">
            {models.length} configured
          </Badge>
        </div>
        <Button onClick={openCreate}>Add model</Button>
      </div>
      <div className="space-y-4">
        <div
          className={`mb-4 flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3 ${featureEnabled ? '' : 'opacity-50'}`}
        >
          <div>
            <Label htmlFor="llm-fallback" className="cursor-pointer text-sm font-medium">
              Use fallback chain
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              On a failing call, fail over to the next enabled model in order (the primary model
              stays primary). Order the list below to set fallback priority.
            </p>
          </div>
          <Switch id="llm-fallback" checked={useFallbackChain} onCheckedChange={toggleFallback} />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : models.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No models yet. Click <span className="font-medium">Add model</span> to configure one.
          </p>
        ) : (
          <div className="space-y-3">
            {models.map((m, idx) => (
              <LLMModelRow
                key={m.id}
                model={m}
                index={idx}
                total={models.length}
                busy={busyId === m.id}
                onMoveUp={() => move(idx, -1)}
                onMoveDown={() => move(idx, 1)}
                onToggleEnabled={() => toggleEnabled(m)}
                onTest={() => testConnection(m)}
                onSetPrimary={() => setPrimary(m)}
                onDuplicate={() => duplicate(m)}
                onEdit={() => openEdit(m)}
                onDelete={() => setDeleteTarget(m)}
              />
            ))}
          </div>
        )}
      </div>

      <LLMModelFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingId={editingId}
        form={form}
        setForm={setForm}
        saving={saving}
        onSubmit={submitForm}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete model?</DialogTitle>
            <DialogDescription>
              This removes <span className="font-medium">{deleteTarget?.label}</span> from the
              registry. Past analyses are not affected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Spinner className="mr-2 h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
