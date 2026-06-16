import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import useQuery from '../hooks/useQuery';
import { invalidateCache } from '../lib/query-cache';
import { buildUrl, withBase } from '../lib/url';
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

interface UploadReportButtonProps {
  onUploadedReport?: () => void;
  label?: string;
}

export default function UploadReportButton({
  onUploadedReport,
  label = 'Upload Report',
}: Readonly<UploadReportButtonProps>) {
  const queryClient = useQueryClient();
  const session = useAuth();
  const [open, setOpen] = useState(false);

  const {
    data: reportProjects,
    error: reportProjectsError,
    isLoading: isReportProjectsLoading,
  } = useQuery<string[]>(buildUrl('/api/report/projects'));

  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState('');
  const [title, setTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) {
      toast.error('Please select a file to upload');
      return;
    }

    setIsUploading(true);

    try {
      const formData = new FormData();

      const metadata: Record<string, string> = {};
      if (project) metadata.project = project;
      if (title) metadata.title = title;

      formData.append('metadata', JSON.stringify(metadata));
      formData.append('report', file);

      const response = await fetch(withBase('/api/report/upload'), {
        method: 'POST',
        body: formData,
        headers: {
          authorization: session.data?.user.jwtToken ?? '',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        toast.error(`Upload failed: ${errorText}`);
        return;
      }

      const uploadedReport = await response.json();
      const reportId = uploadedReport.reportId;

      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/report',
      });
      toast.success(`Report uploaded successfully: ${reportId}`);
      setOpen(false);
      setFile(null);
      setProject('');
      setTitle('');
      onUploadedReport?.();
    } catch (error) {
      toast.error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
    }
  };

  const handleFileButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleClose = () => {
    setFile(null);
    setProject('');
    setTitle('');
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          {isUploading && <Spinner className="mr-2 h-4 w-4" />}
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Report</DialogTitle>
          <DialogDescription>Upload a Playwright report as a ZIP file</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="report-file-input">Report ZIP File</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={handleFileButtonClick}
            >
              <Upload className="mr-2 h-4 w-4" />
              {file ? file.name : 'Choose ZIP file'}
            </Button>
            <input
              ref={fileInputRef}
              accept=".zip"
              className="hidden"
              id="report-file-input"
              type="file"
              onChange={handleFileChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project">Project (optional)</Label>
            <Input
              id="project"
              list="projects-list"
              placeholder="Enter project name"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={isUploading || isReportProjectsLoading}
            />
            {reportProjectsError && (
              <p className="text-sm text-destructive">{reportProjectsError.message}</p>
            )}
            <datalist id="projects-list">
              {reportProjects?.map((proj) => (
                <option key={proj} value={proj} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              placeholder="Enter report title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isUploading}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            Cancel
          </Button>
          <Button disabled={!file || isUploading} onClick={handleUpload}>
            {isUploading && <Spinner className="mr-2 h-4 w-4" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
