import type { LlmStrategy, LlmTaskRouting } from '../types/index.js';

export const STRATEGY_LABELS: Record<LlmStrategy, string> = {
  one_shot: 'One-shot',
  fusion: 'Fusion',
  council: 'Council',
  cascade: 'Cascade',
  self_refine: 'Refine',
};

export function expectedStrategyCalls(routing: LlmTaskRouting | undefined): number {
  const authors = routing?.authors?.length || 1;
  switch (routing?.strategy) {
    case 'fusion':
      return authors + 1; // drafters + synthesizer
    case 'council':
      return authors + (routing.judges?.length || 1); // drafters + judges
    case 'cascade': {
      const tiers = routing.tiers?.length || 1;
      const scorerCalls = routing.cascadeGate === 'checks' ? 0 : Math.max(0, tiers - 1);
      return tiers + scorerCalls;
    }
    case 'self_refine':
      return 1 + 2 * (routing.maxRounds ?? 1); // initial draft + (critique + revise) per round
    default:
      return 1; // one_shot / unset
  }
}

export function describeStrategy(routing: LlmTaskRouting | undefined): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  switch (routing?.strategy) {
    case 'fusion':
      return `${STRATEGY_LABELS.fusion} (${plural(routing.authors?.length || 1, 'author')} → synthesizer)`;
    case 'council':
      return `${STRATEGY_LABELS.council} (${plural(routing.authors?.length || 1, 'author')}, ${plural(routing.judges?.length || 1, 'judge')})`;
    case 'cascade':
      return `${STRATEGY_LABELS.cascade} (${plural(routing.tiers?.length || 1, 'tier')})`;
    case 'self_refine':
      return `${STRATEGY_LABELS.self_refine} (${plural(routing.maxRounds ?? 1, 'round')})`;
    default:
      return STRATEGY_LABELS.one_shot;
  }
}
