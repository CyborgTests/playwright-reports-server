// Semantic series colors for Recharts (raw hsl strings, passed to fill/stroke —
// not Tailwind classes). Single source so a retheme touches one place.
export const CHART_COLORS = {
  passed: 'hsl(142, 76%, 36%)',
  failed: 'hsl(0, 84%, 60%)',
  flaky: 'hsl(38, 92%, 50%)',
  duration: 'hsl(217, 91%, 60%)',
} as const;
