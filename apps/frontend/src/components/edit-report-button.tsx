import { RESERVED_REPORT_FIELDS, type ReportHistory } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import useMutation from '../hooks/useMutation';
import useQuery from '../hooks/useQuery';
import { invalidateCache } from '../lib/query-cache';
import { buildUrl } from '../lib/url';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Spinner } from './ui/spinner';

const isPrimitive = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

function extractTags(report: ReportHistory): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(report as unknown as Record<string, unknown>)) {
    if (RESERVED_REPORT_FIELDS.has(key)) continue;
    if (!isPrimitive(value)) continue;
    out[key] = String(value);
  }
  return out;
}

type TagRow = { id: number; key: string; value: string };

interface EditReportButtonProps {
  report?: ReportHistory;
  reports?: ReportHistory[];
  onUpdated: () => void;
  label?: string;
}

export default function EditReportButton({
  report,
  reports,
  onUpdated,
  label,
}: Readonly<EditReportButtonProps>) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const targets = report ? [report] : (reports ?? []);
  const ids = targets.map((r) => r.reportID);
  const count = ids.length;
  const isBulk = count > 1 || !report;

  const { data: reportProjects } = useQuery<string[]>(buildUrl('/api/report/projects'));

  const initialProject = report?.project ?? '';
  const initialTags = useMemo(() => (report ? extractTags(report) : {}), [report]);

  const [project, setProject] = useState(initialProject);
  const [rows, setRows] = useState<TagRow[]>([]);
  const [nextRowId, setNextRowId] = useState(0);

  useEffect(() => {
    if (!open) return;
    setProject(initialProject);
    if (isBulk) {
      setRows([]);
      setNextRowId(0);
    } else {
      const entries = Object.entries(initialTags);
      setRows(entries.map(([key, value], i) => ({ id: i, key, value })));
      setNextRowId(entries.length);
    }
  }, [open, initialProject, initialTags, isBulk]);

  const {
    mutate: editReports,
    isPending,
    error,
  } = useMutation('/api/report/edit', {
    method: 'PATCH',
    onSuccess: () => {
      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/report',
      });
      toast.success(count === 1 ? 'Report updated' : `${count} reports updated`);
      setOpen(false);
      onUpdated?.();
    },
  });

  const addRow = () => {
    setRows((prev) => [...prev, { id: nextRowId, key: '', value: '' }]);
    setNextRowId((n) => n + 1);
  };

  const updateRow = (id: number, patch: Partial<TagRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  };

  const handleSubmit = () => {
    if (!ids.length) return;

    const body: {
      reportsIds: string[];
      project?: string;
      tags?: Record<string, string>;
      removeTags?: string[];
    } = { reportsIds: ids };

    const trimmedProject = project.trim();
    if (isBulk) {
      if (trimmedProject) body.project = trimmedProject;
    } else if (trimmedProject !== initialProject) {
      if (!trimmedProject) {
        toast.error('Project cannot be empty');
        return;
      }
      body.project = trimmedProject;
    }

    const tags: Record<string, string> = {};
    for (const r of rows) {
      const k = r.key.trim();
      if (!k) continue;
      tags[k] = r.value;
    }

    if (isBulk) {
      if (Object.keys(tags).length > 0) body.tags = tags;
    } else {
      const next = tags;
      const setKeys: Record<string, string> = {};
      const removeKeys: string[] = [];
      for (const [k, v] of Object.entries(next)) {
        if (initialTags[k] !== v) setKeys[k] = v;
      }
      for (const k of Object.keys(initialTags)) {
        if (!(k in next)) removeKeys.push(k);
      }
      if (Object.keys(setKeys).length > 0) body.tags = setKeys;
      if (removeKeys.length > 0) body.removeTags = removeKeys;
    }

    if (!body.project && !body.tags && !body.removeTags) {
      toast.message('No changes to save');
      return;
    }

    editReports({ body });
  };

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const triggerTitle = isBulk
    ? count > 1
      ? `Edit ${count} reports`
      : 'Edit reports'
    : 'Edit report';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          className={label ? '' : 'p-0 min-w-10'}
          disabled={!count}
          size={label ? 'default' : 'icon'}
          title={triggerTitle}
          variant="ghost"
        >
          {label || <Pencil className="h-4 w-4" />}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isBulk ? `Edit ${count} reports` : 'Edit report'}</DialogTitle>
          <DialogDescription>
            {isBulk
              ? 'Project and tags below will be applied to all selected reports. Leave project empty to keep each report unchanged.'
              : 'Change the project and tags for this report. Removed rows are cleared.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="edit-project">Project{isBulk ? ' (optional)' : ''}</Label>
            <Input
              id="edit-project"
              list="edit-projects-list"
              placeholder={isBulk ? 'Leave empty to keep unchanged' : 'Enter project name'}
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={isPending}
            />
            <datalist id="edit-projects-list">
              {reportProjects?.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tags</Label>
              <Button type="button" size="sm" variant="ghost" onClick={addRow} disabled={isPending}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add tag
              </Button>
            </div>
            {rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {isBulk ? 'Add key/value rows to set them on all selected reports.' : 'No tags.'}
              </p>
            )}
            <div className="space-y-2">
              {rows.map((row) => (
                <div key={row.id} className="flex gap-2 items-center">
                  <Input
                    placeholder="key"
                    value={row.key}
                    onChange={(e) => updateRow(row.id, { key: e.target.value })}
                    disabled={isPending}
                    className="flex-1"
                  />
                  <Input
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => updateRow(row.id, { value: e.target.value })}
                    disabled={isPending}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRow(row.id)}
                    disabled={isPending}
                    title="Remove tag"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button disabled={isPending} onClick={handleSubmit}>
            {isPending && <Spinner className="mr-2 h-4 w-4" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
