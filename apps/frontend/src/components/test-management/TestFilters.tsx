import type { TestFilters as TestFiltersType } from '@playwright-reports/shared';
import { useMemo } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
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
import useQuery from '@/hooks/useQuery';
import { formatCategoryName } from '@/lib/format';

interface TestFiltersProps {
  filters: TestFiltersType;
  onFiltersChange: (filters: TestFiltersType) => void;
}

type Tier = 'all' | 'stable' | 'flaky' | 'critical' | 'custom';

export function TestFilters({ filters, onFiltersChange }: Readonly<TestFiltersProps>) {
  const { data: categoriesResponse } = useQuery<{ success: boolean; data: string[] }>(
    '/api/failure-categories'
  );
  const categories = categoriesResponse?.data ?? [];

  const { data: config } = useConfig();
  const warningThreshold = config?.testManagement?.warningThresholdPercentage ?? 10;
  const quarantineThreshold = config?.testManagement?.quarantineThresholdPercentage ?? 50;

  const stableMax = Math.max(0, warningThreshold - 1);
  const flakyMax = Math.max(0, quarantineThreshold - 1);

  const tier = useMemo<Tier>(() => {
    const min = filters.flakinessMin ?? 0;
    const max = filters.flakinessMax ?? 100;
    if (min === 0 && max === 100) return 'all';
    if (min === 0 && max === stableMax) return 'stable';
    if (min === warningThreshold && max === flakyMax) return 'flaky';
    if (min === quarantineThreshold && max === 100) return 'critical';
    return 'custom';
  }, [
    filters.flakinessMin,
    filters.flakinessMax,
    warningThreshold,
    quarantineThreshold,
    stableMax,
    flakyMax,
  ]);

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

  const handleTierChange = (value: string) => {
    switch (value) {
      case 'all':
        onFiltersChange({ ...filters, flakinessMin: 0, flakinessMax: 100 });
        return;
      case 'stable':
        onFiltersChange({ ...filters, flakinessMin: 0, flakinessMax: stableMax });
        return;
      case 'flaky':
        onFiltersChange({
          ...filters,
          flakinessMin: warningThreshold,
          flakinessMax: flakyMax,
        });
        return;
      case 'critical':
        onFiltersChange({
          ...filters,
          flakinessMin: quarantineThreshold,
          flakinessMax: 100,
        });
        return;
    }
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
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
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
          <Label htmlFor="tier-filter">Flakiness</Label>
          <Select value={tier} onValueChange={handleTierChange}>
            <SelectTrigger id="tier-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="stable">Stable (&lt; {warningThreshold}%)</SelectItem>
              <SelectItem value="flaky">
                Flaky ({warningThreshold}–{flakyMax}%)
              </SelectItem>
              <SelectItem value="critical">Critical (≥ {quarantineThreshold}%)</SelectItem>
              {tier === 'custom' && (
                <SelectItem value="custom" disabled>
                  Custom ({filters.flakinessMin ?? 0}–{filters.flakinessMax ?? 100}%)
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="advanced" className="border rounded-md px-3">
          <AccordionTrigger className="text-sm font-medium">
            Advanced — flakiness range
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="min-flakiness">Min Flakiness (%)</Label>
                <Input
                  id="min-flakiness"
                  type="number"
                  placeholder="0"
                  min={0}
                  max={Math.min(filters.flakinessMax ?? 100, 100)}
                  step={1}
                  value={String(filters.flakinessMin ?? 0)}
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
                  value={String(filters.flakinessMax ?? 100)}
                  onChange={(e) => handleFlakinessMaxChange(e.target.value)}
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
