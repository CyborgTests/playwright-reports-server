import type { LlmModel } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { LLM_MODELS_PATH } from '@/hooks/useLlmModels';
import { apiFetch as api, errMessage } from '@/lib/api';
import { LLMModelFormDialog } from './LLMModelFormDialog';
import { LLMModelRow } from './LLMModelRow';
import {
  blankForm,
  type FormState,
  parseCost,
  parsePositiveInt,
  parseTemperature,
} from './llm-model-form';

export default function LLMModelsConfiguration() {
  const session = useAuth();
  const queryClient = useQueryClient();
  const [models, setModels] = useState<LlmModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [useFallbackChain, setUseFallbackChain] = useState(false);
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LlmModel | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api<LlmModel[]>(LLM_MODELS_PATH);
      setModels(data);
      queryClient.setQueryData([LLM_MODELS_PATH], data);
    } catch (err) {
      toast.error(`Failed to load models: ${errMessage(err)}`);
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    refresh();
    api<{ llm?: { useFallbackChain?: boolean; enabled?: boolean } }>('/api/config')
      .then((cfg) => {
        setUseFallbackChain(!!cfg.llm?.useFallbackChain);
        setFeatureEnabled(cfg.llm?.enabled !== false);
      })
      .catch(() => {
        // non-fatal: toggles default to safe values if config can't be read
      });
  }, [session.status, refresh]);

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
        await api(`/api/config/llm-models/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        toast.success('Model updated');
      } else {
        await api('/api/config/llm-models', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Model created - test the connection, then enable it');
      }
      setFormOpen(false);
      await refresh();
    } catch (err) {
      toast.error(`Save failed: ${errMessage(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (m: LlmModel) => {
    setBusyId(m.id);
    try {
      const result = await api<{ success: boolean; error?: string; models?: string[] }>(
        `/api/config/llm-models/${m.id}/test-connection`,
        { method: 'POST' }
      );
      if (result.success) toast.success(`"${m.label}" connected`);
      else toast.error(`Connection failed: ${result.error ?? 'unknown error'}`);
      await refresh();
    } catch (err) {
      toast.error(`Test failed: ${errMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (m: LlmModel) => {
    const next = !m.enabled;
    setModels((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: next } : x)));
    try {
      const updated = await api<LlmModel>(`/api/config/llm-models/${m.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: next }),
      });
      setModels((prev) => prev.map((x) => (x.id === m.id ? updated : x)));
    } catch (err) {
      toast.error(`Failed: ${errMessage(err)}`);
      setModels((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: m.enabled } : x)));
    }
  };

  const setPrimary = async (m: LlmModel) => {
    setBusyId(m.id);
    try {
      await api(`/api/config/llm-models/${m.id}/primary`, { method: 'PATCH' });
      toast.success(`"${m.label}" is now the primary model`);
      await refresh();
    } catch (err) {
      toast.error(`Failed: ${errMessage(err)}`);
    } finally {
      setBusyId(null);
    }
  };

  const duplicate = async (m: LlmModel) => {
    setBusyId(m.id);
    try {
      const copy = await api<LlmModel>(`/api/config/llm-models/${m.id}/duplicate`, {
        method: 'POST',
      });
      await refresh();
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
    setModels(reordered);
    try {
      await api('/api/config/llm-models/order', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds: reordered.map((m) => m.id) }),
      });
    } catch (err) {
      toast.error(`Reorder failed: ${errMessage(err)}`);
      await refresh(); // rollback to server
    }
  };

  const toggleFallback = async (next: boolean) => {
    setUseFallbackChain(next);
    try {
      const fd = new FormData();
      fd.append('llmUseFallbackChain', String(next));
      await api('/api/config', { method: 'PATCH', body: fd });
    } catch (err) {
      setUseFallbackChain(!next);
      toast.error(`Failed to update fallback setting: ${errMessage(err)}`);
    }
  };

  const toggleFeatureEnabled = async (next: boolean) => {
    setFeatureEnabled(next);
    try {
      const fd = new FormData();
      fd.append('llmFeatureEnabled', String(next));
      await api('/api/config', { method: 'PATCH', body: fd });
      toast.success(next ? 'LLM features enabled' : 'LLM features disabled');
    } catch (err) {
      setFeatureEnabled(!next);
      toast.error(`Failed to update LLM setting: ${errMessage(err)}`);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/config/llm-models/${deleteTarget.id}`, { method: 'DELETE' });
      toast.success('Model deleted');
      setDeleteTarget(null);
      await refresh();
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
        <div className="mb-4 flex items-start justify-between gap-4 rounded-md border bg-primary/5 p-3">
          <div>
            <Label htmlFor="llm-feature-enabled" className="cursor-pointer text-sm font-medium">
              Enable LLM features
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Master switch. When off, no LLM calls are made - failure analysis, summaries and the
              queue are all paused, regardless of the primary model.
            </p>
          </div>
          <Switch
            id="llm-feature-enabled"
            checked={featureEnabled}
            onCheckedChange={toggleFeatureEnabled}
          />
        </div>
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

        {loading ? (
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
