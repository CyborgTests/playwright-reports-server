export function niceAxisTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

interface StickyYAxisProps {
  axisMax: number;
  width: number;
  chartHeight: number;
  plotTop: number;
  plotBottom: number;
  fontSize?: number;
  formatTick?: (value: number) => string;
}

export function StickyYAxis({
  axisMax,
  width,
  chartHeight,
  plotTop,
  plotBottom,
  fontSize = 12,
  formatTick = String,
}: Readonly<StickyYAxisProps>) {
  const ticks = niceAxisTicks(axisMax);
  const top = axisMax > 0 ? ticks[ticks.length - 1] : 1;
  const yFor = (v: number) => plotBottom - (v / top) * (plotBottom - plotTop);
  return (
    <svg
      width={width}
      height={chartHeight}
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <line
        x1={width - 1}
        y1={plotTop}
        x2={width - 1}
        y2={plotBottom}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      {ticks.map((v) => {
        const y = yFor(v);
        return (
          <g key={v}>
            <line
              x1={width - 5}
              y1={y}
              x2={width - 1}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.3}
            />
            <text
              x={width - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={fontSize}
              fill="currentColor"
            >
              {formatTick(v)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
