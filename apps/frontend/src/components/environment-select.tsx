import { DEFAULT_ENVIRONMENT_FILTER, ENV_UNKNOWN_FILTER } from '@playwright-reports/shared';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import useQuery from '../hooks/useQuery';
import { environmentOptionLabel } from '../lib/environment';
import { buildUrl } from '../lib/url';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface EnvironmentSelectProps {
  onSelect: (environment: string) => void;
  entity: 'result' | 'report';
  selectedEnvironment?: string;
  project?: string;
  className?: string;
  label?: string;
  showLabel?: boolean;
}

export default function EnvironmentSelect({
  onSelect,
  entity,
  selectedEnvironment = DEFAULT_ENVIRONMENT_FILTER,
  project,
  className = 'w-full sm:w-48',
  label = 'Environment',
  showLabel = true,
}: Readonly<EnvironmentSelectProps>) {
  const [hasOpened, setHasOpened] = useState(false);
  const environmentsUrl = useMemo(() => {
    const params: Record<string, string> = {};
    if (project && project !== 'all') params.project = project;
    return buildUrl(`/api/${entity}/environments`, params);
  }, [entity, project]);

  const {
    data: environments,
    error,
    isLoading,
  } = useQuery<string[]>(environmentsUrl, {
    dependencies: [environmentsUrl],
    enabled: hasOpened,
  });

  const fetched = Array.isArray(environments) ? environments : [];
  const items = useMemo(() => {
    const values = [DEFAULT_ENVIRONMENT_FILTER, ...fetched, ENV_UNKNOWN_FILTER];
    if (
      selectedEnvironment &&
      selectedEnvironment !== DEFAULT_ENVIRONMENT_FILTER &&
      selectedEnvironment !== ENV_UNKNOWN_FILTER &&
      !values.includes(selectedEnvironment)
    ) {
      values.splice(1, 0, selectedEnvironment);
    }
    return values;
  }, [fetched, selectedEnvironment]);

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  const selectId = `environment-select-${entity}`;

  return (
    <div className={showLabel ? 'flex flex-col gap-2' : ''}>
      {showLabel && (
        <Label htmlFor={selectId} className="text-sm font-medium">
          {label}
        </Label>
      )}
      <Select
        value={selectedEnvironment}
        onValueChange={onSelect}
        onOpenChange={(open) => {
          if (open && !hasOpened) setHasOpened(true);
        }}
      >
        <SelectTrigger id={selectId} className={className} aria-label="Filter by environment">
          <SelectValue placeholder="All environments" />
        </SelectTrigger>
        <SelectContent>
          {items.map((environment) => (
            <SelectItem key={environment} value={environment}>
              {environmentOptionLabel(environment)}
            </SelectItem>
          ))}
          {hasOpened && isLoading && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</div>
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
