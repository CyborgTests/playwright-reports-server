import { toast } from 'sonner';
import useQuery from '../hooks/useQuery';
import { buildUrl } from '../lib/url';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface TagSelectProps {
  onSelect?: (tags: string[]) => void;
  refreshId?: string;
  entity: 'result' | 'report';
  project?: string;
  className?: string;
}

export default function TagSelect({
  refreshId,
  onSelect,
  entity,
  project,
  className = 'w-48',
}: Readonly<TagSelectProps>) {
  const {
    data: tags,
    error,
    isLoading,
  } = useQuery<string[]>(buildUrl(`/api/${entity}/tags`, project ? { project } : undefined), {
    dependencies: [refreshId, project],
  });

  const handleChange = (value: string) => {
    // For single select, pass as array for compatibility
    onSelect?.([value]);
  };

  error && toast.error(error.message);

  return (
    <Select onValueChange={handleChange} disabled={!tags?.length || isLoading}>
      <SelectTrigger id="tag-select" className={className} aria-label="Filter by tag">
        <SelectValue placeholder="Filter by tag" />
      </SelectTrigger>
      <SelectContent>
        {tags?.map((tag) => (
          <SelectItem key={tag} value={tag}>
            {tag}
          </SelectItem>
        )) ?? []}
      </SelectContent>
    </Select>
  );
}
