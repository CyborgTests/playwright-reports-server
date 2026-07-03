import type { DiscoveredModel, LLMProviderType, LlmModel } from '@playwright-reports/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { LLM_MODELS_PATH } from '@/hooks/useLlmModels';
import useMutation from '@/hooks/useMutation';
import { errorMessage } from '@/lib/api';
import { PROVIDERS } from './llm-model-form';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';
const IMPORT_CONCURRENCY = 3;

type SortKey = 'name' | 'inputCost' | 'context';
type DiscoverResponse = { success: boolean; error?: string; models?: DiscoveredModel[] };

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');
const modelName = (m: DiscoveredModel) => m.name || m.id;
const formatContext = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;

export function LLMImportModelsDialog({
  open,
  onOpenChange,
  mode,
  reuseModelId,
  existingModels,
  onImported,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'fresh' | 'reuse';
  reuseModelId: string | null;
  existingModels: LlmModel[];
  onImported: () => void;
}>) {
  const source = reuseModelId ? existingModels.find((m) => m.id === reuseModelId) : undefined;

  const [provider, setProvider] = useState<LLMProviderType>('openai');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<DiscoveredModel[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [freeOnly, setFreeOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const cache = useRef<Record<string, DiscoveredModel[]>>({});

  const effectiveProvider = mode === 'reuse' ? (source?.provider ?? 'openai') : provider;
  const effectiveBaseUrl = mode === 'reuse' ? (source?.baseUrl ?? '') : baseUrl;

  const discoverMut = useMutation<DiscoverResponse, Record<string, unknown>>(
    '/api/config/llm-models/discover',
    { method: 'POST', silent: true }
  );
  const createMut = useMutation<LlmModel, Record<string, unknown>>(LLM_MODELS_PATH, {
    method: 'POST',
    silent: true,
  });

  const runDiscovery = async (body: Record<string, unknown>, signature: string) => {
    if (cache.current[signature]) {
      setModels(cache.current[signature]);
      setDiscoverError(null);
      return;
    }
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const result = await discoverMut.mutateAsync({ body });
      if (!result.success || !result.models) {
        setDiscoverError(result.error ?? 'Discovery failed');
        return;
      }
      cache.current[signature] = result.models;
      setModels(result.models);
    } catch (error) {
      setDiscoverError(errorMessage(error));
    } finally {
      setDiscovering(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs on open only
  useEffect(() => {
    if (!open || mode !== 'reuse' || !reuseModelId) return;
    setSelected(new Set());
    void runDiscovery({ modelId: reuseModelId }, `reuse:${reuseModelId}`);
  }, [open, mode, reuseModelId]);

  useEffect(() => {
    if (open && mode === 'fresh') {
      setModels(null);
      setDiscoverError(null);
      setSelected(new Set());
      setApiKey('');
    }
  }, [open, mode]);

  const pricingAvailable = useMemo(
    () => (models ?? []).some((m) => m.inputCostPerMTok != null || m.isFree != null),
    [models]
  );

  const isImported = (m: DiscoveredModel) =>
    existingModels.some(
      (x) => normalizeBaseUrl(x.baseUrl) === normalizeBaseUrl(effectiveBaseUrl) && x.model === m.id
    );

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = models ?? [];
    if (!query) return list;
    return list.filter(
      (m) => m.id.toLowerCase().includes(query) || (m.name ?? '').toLowerCase().includes(query)
    );
  }, [models, search]);

  const hiddenByFree = freeOnly && pricingAvailable ? searched.filter((m) => !m.isFree).length : 0;

  const visible = useMemo(() => {
    const list = freeOnly && pricingAvailable ? searched.filter((m) => m.isFree) : searched;
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortKey === 'inputCost') {
        return (a.inputCostPerMTok ?? Infinity) - (b.inputCostPerMTok ?? Infinity);
      }
      if (sortKey === 'context') return (b.contextLength ?? 0) - (a.contextLength ?? 0);
      return modelName(a).localeCompare(modelName(b));
    });
    return sorted;
  }, [searched, freeOnly, pricingAvailable, sortKey]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildPayload = (m: DiscoveredModel): Record<string, unknown> => {
    const payload: Record<string, unknown> = {
      label: modelName(m),
      provider: effectiveProvider,
      baseUrl: effectiveBaseUrl,
      model: m.id,
      contextWindow: m.contextLength ?? null,
      inputCostPerMTok: m.inputCostPerMTok ?? null,
      outputCostPerMTok: m.outputCostPerMTok ?? null,
    };
    if (mode === 'reuse') {
      payload.sourceModelId = reuseModelId;
      // Inherit the source row's concurrency group - siblings share its budget.
      if (source?.concurrencyGroupId) payload.concurrencyGroupId = source.concurrencyGroupId;
    } else if (apiKey) {
      payload.apiKey = apiKey;
    }
    return payload;
  };

  const importSelected = async () => {
    const chosen = (models ?? []).filter((m) => selected.has(m.id) && !isImported(m));
    if (chosen.length === 0) return;
    setImporting(true);
    const queue = [...chosen];
    let ok = 0;
    const failed: string[] = [];
    const worker = async () => {
      while (queue.length > 0) {
        const m = queue.shift();
        if (!m) break;
        try {
          await createMut.mutateAsync({ body: buildPayload(m) });
          ok += 1;
        } catch (error) {
          failed.push(`${modelName(m)}: ${errorMessage(error)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
    setImporting(false);
    onImported();
    if (failed.length === 0) {
      toast.success(`Imported ${ok} model${ok === 1 ? '' : 's'} - test and enable them below`);
      onOpenChange(false);
    } else {
      setSelected(new Set());
      toast.error(`Imported ${ok}, ${failed.length} failed: ${failed[0]}`);
    }
  };

  const selectableCount = (models ?? []).filter((m) => selected.has(m.id) && !isImported(m)).length;

  const showList = mode === 'reuse' || models !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import models</DialogTitle>
          <DialogDescription>
            {mode === 'reuse' && source
              ? `Add more models from ${source.baseUrl}.`
              : "List a provider's models and import several at once."}
          </DialogDescription>
        </DialogHeader>

        {mode === 'fresh' && models === null && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="imp-provider">Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as LLMProviderType)}>
                  <SelectTrigger id="imp-provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="imp-base">Base URL</Label>
                <Input
                  id="imp-base"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={OPENROUTER_BASE_URL}
                />
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    void navigator.clipboard?.writeText(OPENROUTER_BASE_URL);
                    toast.success('Copied');
                  }}
                >
                  e.g. {OPENROUTER_BASE_URL}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="imp-key">API key (optional)</Label>
              <Input
                id="imp-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
              />
              <a
                href={OPENROUTER_KEYS_URL}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                e.g. OpenRouter →
              </a>
            </div>
            {discoverError && <p className="text-sm text-destructive">{discoverError}</p>}
          </div>
        )}

        {showList && (
          <div className="flex flex-col gap-3 min-h-0 flex-1">
            {discoverError ? (
              <p className="text-sm text-destructive">{discoverError}</p>
            ) : discovering ? (
              <p className="text-sm text-muted-foreground">Loading models…</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search models…"
                    className="max-w-xs"
                  />
                  <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name">Sort: name</SelectItem>
                      <SelectItem value="inputCost">Sort: input cost</SelectItem>
                      <SelectItem value="context">Sort: context</SelectItem>
                    </SelectContent>
                  </Select>
                  {pricingAvailable && (
                    <div className="flex items-center gap-2">
                      <Switch id="imp-free" checked={freeOnly} onCheckedChange={setFreeOnly} />
                      <Label htmlFor="imp-free" className="text-sm">
                        Free only
                      </Label>
                    </div>
                  )}
                </div>

                {hiddenByFree > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {hiddenByFree} hidden by Free only{' '}
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => setFreeOnly(false)}
                    >
                      show all
                    </button>
                  </p>
                )}

                <div className="overflow-y-auto border rounded-md divide-y flex-1">
                  {visible.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-3">No matching models.</p>
                  ) : (
                    visible.map((m) => {
                      const imported = isImported(m);
                      return (
                        <button
                          type="button"
                          key={m.id}
                          disabled={imported}
                          onClick={() => toggle(m.id)}
                          className={`flex w-full items-center gap-3 p-2 text-left text-sm ${imported ? 'opacity-50' : 'cursor-pointer hover:bg-muted/40'}`}
                        >
                          <Checkbox
                            checked={selected.has(m.id)}
                            disabled={imported}
                            className="pointer-events-none"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium truncate">{modelName(m)}</span>
                              {m.isFree && <span className="text-xs text-green-600">free</span>}
                              {imported && (
                                <span className="text-xs text-muted-foreground">imported</span>
                              )}
                            </div>
                            <div className="font-mono text-xs text-muted-foreground truncate">
                              {m.id}
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground text-right shrink-0 space-y-0.5">
                            {m.contextLength != null && (
                              <div>{formatContext(m.contextLength)} ctx</div>
                            )}
                            {(m.inputCostPerMTok != null || m.outputCostPerMTok != null) && (
                              <div>
                                ${m.inputCostPerMTok ?? '?'} / ${m.outputCostPerMTok ?? '?'}
                              </div>
                            )}
                            {m.modality === 'text+image' && <div>vision</div>}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {showList && !discovering ? `${selectableCount} selected` : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
              Cancel
            </Button>
            {mode === 'fresh' && models === null ? (
              <Button
                onClick={() =>
                  runDiscovery(
                    { provider, baseUrl, apiKey },
                    `fresh:${provider}|${normalizeBaseUrl(baseUrl)}`
                  )
                }
                disabled={discovering || !baseUrl.trim()}
              >
                {discovering ? 'Loading…' : 'Discover models'}
              </Button>
            ) : (
              <Button onClick={importSelected} disabled={importing || selectableCount === 0}>
                {importing ? 'Importing…' : `Import ${selectableCount}`}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
