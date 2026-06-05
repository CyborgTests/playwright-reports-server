import {
  FAILURE_CATEGORIES,
  FLAKINESS_THRESHOLDS,
  type FlakinessTier,
  ROOT_CAUSE_CATEGORIES,
  type TestFilters as TestFiltersType,
  type TestsSort,
} from '@playwright-reports/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useConfig } from '@/hooks/useConfig';
import { formatCategoryName } from '@/lib/format';
import { cn } from '@/lib/utils';

interface TestFiltersProps {
  filters: TestFiltersType;
  onFiltersChange: (filters: TestFiltersType) => void;
}

const TIER_ORDER: FlakinessTier[] = ['stable', 'flaky', 'critical'];

const CATEGORY_OPTIONS = Array.from(
  new Set<string>([...ROOT_CAUSE_CATEGORIES, ...FAILURE_CATEGORIES])
);

export function TestFilters({ filters, onFiltersChange }: Readonly<TestFiltersProps>) {
  const categories = CATEGORY_OPTIONS;

  const { data: config } = useConfig();
  const warningThreshold =
    config?.testManagement?.warningThresholdPercentage ?? FLAKINESS_THRESHOLDS.WARNING_PERCENTAGE;
  const quarantineThreshold =
    config?.testManagement?.quarantineThresholdPercentage ??
    FLAKINESS_THRESHOLDS.QUARANTINE_PERCENTAGE;

  const selectedTiers = filters.tiers ?? [];
  const sort: TestsSort = filters.sort ?? 'default';

  const tierLabel = (tier: FlakinessTier) => {
    switch (tier) {
      case 'stable':
        return `Stable (< ${warningThreshold}%)`;
      case 'flaky':
        return `Flaky (${warningThreshold}–${quarantineThreshold - 1}%)`;
      case 'critical':
        return `Critical (≥ ${quarantineThreshold}%)`;
    }
  };

  const toggleTier = (tier: FlakinessTier) => {
    const next = selectedTiers.includes(tier)
      ? selectedTiers.filter((t) => t !== tier)
      : [...selectedTiers, tier];
    onFiltersChange({
      ...filters,
      tiers: next.length === 0 ? undefined : next,
    });
  };

  const handleSortChange = (value: string) => {
    onFiltersChange({ ...filters, sort: value as TestsSort });
  };

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
        <Label htmlFor="status-filter">Quarantine</Label>
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
        <Label>Sort</Label>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            <SelectItem value="slowest">Slowest first</SelectItem>
            <SelectItem value="stale">Tests not running</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Flakiness</Label>
        <div className="flex flex-wrap gap-1">
          {TIER_ORDER.map((t) => {
            const active = selectedTiers.includes(t);
            return (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={active ? 'default' : 'outline'}
                onClick={() => toggleTier(t)}
                aria-pressed={active}
                className={cn('h-8 text-xs px-2', active && 'shadow-sm')}
                title={tierLabel(t)}
              >
                {t}
              </Button>
            );
          })}
          {selectedTiers.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onFiltersChange({ ...filters, tiers: undefined })}
              className="h-8 text-xs px-2 text-muted-foreground"
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
