'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import useQuery from '../hooks/useQuery';
import { defaultProjectName } from '../lib/constants';
import { buildUrl } from '../lib/url';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface ProjectSelectProps {
  onSelect: (project: string) => void;
  refreshId?: string;
  entity: 'result' | 'report';
  selectedProject?: string;
  className?: string;
  label?: string;
  showLabel?: boolean;
}

export default function ProjectSelect({
  refreshId,
  onSelect,
  entity,
  selectedProject,
  className = 'w-64 min-w-36',
  label = 'Project',
  showLabel = true,
}: Readonly<ProjectSelectProps>) {
  const {
    data: projects,
    error,
    isLoading,
  } = useQuery<string[]>(buildUrl(`/api/${entity}/projects`), {
    dependencies: [refreshId],
  });

  const [localStorageProject, setLocalStorageProject] = useState<string | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const items = [defaultProjectName, ...(Array.isArray(projects) ? projects : [])];
  const localStorageKey = `selected-project`;

  useEffect(() => {
    if (isInitialized) return;

    try {
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        const stored = localStorage.getItem(localStorageKey);
        if (!stored) {
          setIsInitialized(true);
          return;
        }

        setLocalStorageProject(stored);
      }
    } catch (error) {
      console.warn('Failed to read from localStorage:', error);
    }
    setIsInitialized(true);
  }, [isInitialized]);

  useEffect(() => {
    if (!isInitialized || !localStorageProject) return;

    try {
      if (
        !items.includes(localStorageProject) &&
        localStorageProject !== defaultProjectName &&
        !isLoading
      ) {
        localStorage.removeItem(localStorageKey);
        setLocalStorageProject(null);
      }
    } catch (error) {
      console.warn('Failed to validate localStorage project:', error);
    }
  }, [localStorageProject, isInitialized, items.includes, isLoading]);

  const effectiveSelectedProject = localStorageProject || selectedProject || defaultProjectName;

  useEffect(() => {
    onSelect?.(effectiveSelectedProject);
  }, [effectiveSelectedProject, onSelect]);

  const handleChange = (value: string) => {
    saveToLocalStorage(value);
  };

  const saveToLocalStorage = (project: string) => {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        localStorage.setItem(localStorageKey, project);
        setLocalStorageProject(project);
      }
    } catch (error) {
      console.warn('Failed to write to localStorage:', error);
    }
  };

  error && toast.error(error.message);

  const selectId = `project-select-${entity}`;

  return (
    <div className={showLabel ? 'flex flex-col gap-2' : ''}>
      {showLabel && (
        <Label htmlFor={selectId} className="text-sm font-medium">
          {label}
        </Label>
      )}
      <Select
        value={effectiveSelectedProject}
        onValueChange={handleChange}
        disabled={items.length <= 1 || isLoading}
      >
        <SelectTrigger id={selectId} className={className}>
          <SelectValue placeholder={showLabel ? `Select ${label.toLowerCase()}` : label} />
        </SelectTrigger>
        <SelectContent>
          {items.map((project) => (
            <SelectItem key={project} value={project}>
              {project}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
