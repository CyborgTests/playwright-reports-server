import type { PromptSegment, SegmentedPrompt } from '../types/index.js';
import type { MustacheSubstitution } from './promptTypes.js';

export function buildSegment(
  id: string,
  role: 'system' | 'user',
  stable: boolean,
  content: string | undefined
): PromptSegment | null {
  if (!content?.trim()) return null;
  return { id, role, stable, content };
}

export function assembleSegments(segments: Array<PromptSegment | null>): SegmentedPrompt {
  return { segments: segments.filter((s): s is PromptSegment => s !== null) };
}

export function resolveSystemPrompt(
  builtInDefault: string,
  legacyCustom?: string,
  perTaskCustom?: string
): string {
  return perTaskCustom?.trim() || legacyCustom?.trim() || builtInDefault;
}

export function applyMustache(
  template: string,
  bindings: Record<string, string | number | boolean | undefined>,
  allowlist: ReadonlySet<string>
): MustacheSubstitution {
  let substituted = false;
  const rendered = template.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, name) => {
    if (!allowlist.has(name)) {
      console.warn(`[llm.prompts] mustache var "${name}" not in allowlist — left as-is`);
      return match;
    }
    const value = bindings[name];
    if (value === undefined || value === null) {
      console.warn(`[llm.prompts] mustache var "${name}" has no binding — left as-is`);
      return match;
    }
    substituted = true;
    return String(value);
  });
  return { substituted, rendered };
}

export function renderSegmentsForDebug(prompt: SegmentedPrompt): string {
  return prompt.segments
    .filter((s) => s.role !== 'system')
    .map((s) => s.content)
    .join('\n\n');
}
