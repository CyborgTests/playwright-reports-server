import { useQueryClient } from '@tanstack/react-query';
import { Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../hooks/useAuth';
import useQuery from '../hooks/useQuery';
import { invalidateCache } from '../lib/query-cache';
import { buildUrl, withBase } from '../lib/url';
import { Badge } from './ui/badge';
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

interface UploadResultsButtonProps {
  onUploadedResult?: () => void;
  label?: string;
}

export default function UploadResultsButton({
  onUploadedResult,
  label = 'Upload Results',
}: Readonly<UploadResultsButtonProps>) {
  const queryClient = useQueryClient();
  const session = useAuth();
  const [open, setOpen] = useState(false);

  const {
    data: resultProjects,
    error: resultProjectsError,
    isLoading: isResultProjectsLoading,
  } = useQuery<string[]>(buildUrl('/api/result/projects'));

  const [file, setFile] = useState<File | null>(null);
  const [project, setProject] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [currentTag, setCurrentTag] = useState('');
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

      formData.append('file', file);

      if (project) {
        formData.append('project', project);
      }

      tags.forEach((tag) => {
        const [key, value] = tag.split(': ');
        if (key && value) {
          formData.append(key.trim(), value.trim());
        }
      });

      const response = await fetch(withBase('/api/result/upload'), {
        method: 'PUT',
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

      await response.json();

      invalidateCache(queryClient, {
        queryKeys: ['/api/info'],
        predicate: '/api/result',
      });
      toast.success('Results uploaded successfully');
      setOpen(false);
      setFile(null);
      setProject('');
      setTags([]);
      setCurrentTag('');
      onUploadedResult?.();
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

  const handleAddTag = () => {
    if (currentTag.trim() && currentTag.includes(': ')) {
      setTags([...tags, currentTag.trim()]);
      setCurrentTag('');
    } else if (currentTag.trim()) {
      toast.error('Tag must be in format "key: value"');
    }
  };

  const handleTagInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    if (value.includes(':') && !value.includes(': ')) {
      const colonIndex = value.indexOf(':');
      const newValue = `${value.slice(0, colonIndex + 1)} ${value.slice(colonIndex + 1)}`;
      setCurrentTag(newValue);
    } else {
      setCurrentTag(value);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleClose = () => {
    setFile(null);
    setProject('');
    setTags([]);
    setCurrentTag('');
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
          <DialogTitle>Upload Results</DialogTitle>
          <DialogDescription>Upload test results file (.zip or .json)</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="file-input">Result File</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start"
              onClick={handleFileButtonClick}
            >
              <Upload className="mr-2 h-4 w-4" />
              {file ? file.name : 'Choose file (.zip, .json)'}
            </Button>
            <input
              ref={fileInputRef}
              accept=".zip,.json"
              className="hidden"
              id="file-input"
              type="file"
              onChange={handleFileChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="project-input">Project (optional)</Label>
            <Input
              id="project-input"
              list="projects-list"
              placeholder="Enter project name"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              disabled={isUploading || isResultProjectsLoading}
            />
            {resultProjectsError && (
              <p className="text-sm text-destructive">{resultProjectsError.message}</p>
            )}
            <datalist id="projects-list">
              {resultProjects?.map((proj) => (
                <option key={proj} value={proj} />
              ))}
            </datalist>
          </div>

          <div className="space-y-2">
            <Label htmlFor="tag-input">Tags (optional)</Label>
            <div className="flex gap-2">
              <Input
                id="tag-input"
                className="flex-1"
                placeholder="Enter tag (e.g., 'key:value' or 'key: value')"
                value={currentTag}
                onChange={handleTagInputChange}
                onKeyDown={handleKeyPress}
                disabled={isUploading}
              />
              <Button
                type="button"
                disabled={isUploading || !currentTag.trim()}
                size="sm"
                onClick={handleAddTag}
              >
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {tags.map((tag) => (
                  <Badge key={`tag-${tag}`} variant="secondary" className="gap-1 pr-1">
                    <span>{tag}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 p-0"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            )}
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
