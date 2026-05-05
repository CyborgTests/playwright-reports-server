import type { TestFilters as TestFiltersType } from '@playwright-reports/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import useQuery from '@/hooks/useQuery';
import { formatCategoryName } from '@/lib/format';

interface TestFiltersProps {
  filters: TestFiltersType;
  onFiltersChange: (filters: TestFiltersType) => void;
}

export function TestFilters({ filters, onFiltersChange }: Readonly<TestFiltersProps>) {
  const { data: categoriesResponse } = useQuery<{ success: boolean; data: string[] }>(
    '/api/failure-categories'
  );
  const categories = categoriesResponse?.data ?? [];

  const handleFailureCategoryChange = (value: string) => {
    onFiltersChange({
      ...filters,
      failureCategory: value === 'all' ? undefined : value,
    });
  };

  const handleStatusChange = (value: string) => {
    onFiltersChange({
      ...filters,
      status: value as TestFiltersType['status'],
    });
  };

  const handleFlakinessMinChange = (value: string) => {
    const numValue = Number.parseInt(value, 10);
    const validatedValue = Number.isNaN(numValue) ? 0 : Math.min(Math.max(numValue, 0), 100);

    onFiltersChange({
      ...filters,
      flakinessMin: validatedValue,
      flakinessMax:
        filters.flakinessMax && validatedValue > filters.flakinessMax
          ? validatedValue
          : filters.flakinessMax,
    });
  };

  const handleFlakinessMaxChange = (value: string) => {
    const numValue = Number.parseInt(value, 10);
    const validatedValue = Number.isNaN(numValue) ? 100 : Math.min(Math.max(numValue, 0), 100);

    onFiltersChange({
      ...filters,
      flakinessMin:
        filters.flakinessMin && validatedValue < filters.flakinessMin
          ? validatedValue
          : filters.flakinessMin,
      flakinessMax: validatedValue,
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="search-filter">Search</Label>
        <Input
          id="search-filter"
          type="text"
          placeholder="Search by test title or file path..."
          value={filters.search ?? ''}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value || undefined })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="status-filter">Status</Label>
        <Select value={filters.status ?? 'all'} onValueChange={handleStatusChange}>
          <SelectTrigger id="status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tests</SelectItem>
            <SelectItem value="not-quarantined">Not Quarantined</SelectItem>
            <SelectItem value="quarantined">Quarantined</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {categories.length > 0 && (
        <div className="space-y-2">
          <Label htmlFor="category-filter">Failure Category</Label>
          <Select
            value={filters.failureCategory ?? 'all'}
            onValueChange={handleFailureCategoryChange}
          >
            <SelectTrigger id="category-filter">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {formatCategoryName(cat)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="min-flakiness">Min Flakiness (%)</Label>
        <Input
          id="min-flakiness"
          type="number"
          placeholder="0"
          min={0}
          max={Math.min(filters.flakinessMax ?? 100, 100)}
          step={1}
          value={String(filters.flakinessMin || 0)}
          onChange={(e) => handleFlakinessMinChange(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="max-flakiness">Max Flakiness (%)</Label>
        <Input
          id="max-flakiness"
          type="number"
          placeholder="100"
          min={Math.max(filters.flakinessMin ?? 0, 0)}
          max={100}
          step={1}
          value={String(filters.flakinessMax || 100)}
          onChange={(e) => handleFlakinessMaxChange(e.target.value)}
        />
      </div>
    </div>
  );
}
