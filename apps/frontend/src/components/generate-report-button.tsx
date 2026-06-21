import type { Result } from '@playwright-reports/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import useMutation from '../hooks/useMutation';
import useQuery from '../hooks/useQuery';
import { invalidateCache } from '../lib/query-cache';
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

interface DeleteProjectButtonProps {
  results: Result[];
  projects: string[];
  onGeneratedReport?: () => void;
}

export default function GenerateReportButton({
  results,
  projects,
  onGeneratedReport,
}: Readonly<DeleteProjectButtonProps>) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const { mutate: generateReport, isPending } = useMutation('/api/report/generate', {
    method: 'POST',
    onSuccess: (data: { reportId: string }) => {
      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/report',
      });
      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/result',
      });
      toast.success(`report ${data?.reportId} is generated`);
      setProjectName('');
      setCustomName('');
      setGenerationError(null);
      setOpen(false);
      onGeneratedReport?.();
    },
    onError: (err: Error) => {
      let errorMessage = err.message;
      if (
        err.message.includes('ENOENT') ||
        err.message.includes('not found') ||
        err.message.includes('404')
      ) {
        errorMessage =
          'One or more selected results were not found. Please refresh the page and try again.';
      } else if (err.message.includes('ResultID not found')) {
        errorMessage =
          'Some selected results no longer exist. Please refresh the page and select valid results.';
      }

      setGenerationError(errorMessage);
    },
  });

  const { data: resultProjects, error: resultProjectsError } =
    useQuery<string[]>(`/api/result/projects`);

  const [projectName, setProjectName] = useState('');
  const [customName, setCustomName] = useState('');

  useEffect(() => {
    !projectName && setProjectName(projects?.at(0) ?? '');
  }, [projects, projectName]);

  const GenerateReport = async () => {
    if (!results?.length) {
      return;
    }

    setGenerationError(null);

    const validResults = results.filter((r) => r.resultID && r.resultID.trim() !== '');
    if (validResults.length !== results.length) {
      setGenerationError('Some selected results are invalid or missing IDs');
      return;
    }

    const resultIds = validResults.map((r) => r.resultID);
    generateReport({
      body: { resultsIds: resultIds, project: projectName, title: customName },
    });
  };

  const allProjects = Array.from(new Set([...projects, ...(resultProjects ?? [])]));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={!results?.length}>
          {isPending && <Spinner className="mr-2 h-4 w-4" />}
          Merge
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
          <DialogDescription>Create a new report from selected test results</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {generationError ? (
            <div className="flex flex-col gap-2">
              <p className="font-semibold text-destructive">Report generation failed:</p>
              <pre className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 text-sm text-destructive font-mono whitespace-pre-wrap break-words overflow-auto max-h-96 select-text">
                {generationError}
              </pre>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="project">Project name</Label>
                <Input
                  id="project"
                  list="projects-list"
                  placeholder="leave empty if not required"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={isPending}
                />
                {resultProjectsError && (
                  <p className="text-sm text-destructive">{resultProjectsError.message}</p>
                )}
                <datalist id="projects-list">
                  {allProjects.map((project) => (
                    <option key={project} value={project} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-name">Custom report name</Label>
                <Input
                  id="custom-name"
                  placeholder="leave empty if not required"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  maxLength={36}
                  disabled={isPending}
                />
                <p className="text-xs text-muted-foreground">{customName.length}/36 characters</p>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Close
          </Button>
          {!generationError && (
            <Button disabled={isPending} onClick={GenerateReport}>
              {isPending && <Spinner className="mr-2 h-4 w-4" />}
              Generate
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
