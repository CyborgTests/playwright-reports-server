import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { MarkdownRenderer } from '@/components/markdown-renderer';

interface AnalysisSection {
  heading: string;
  body: string;
}

interface AnalysisSectionsProps<S extends AnalysisSection> {
  sections: S[];
  summary: ReactNode;
  iconFor: (heading: string) => LucideIcon;
  fallbackProject?: string;
  headingExtra?: (section: S) => ReactNode;
}

export function AnalysisSections<S extends AnalysisSection>({
  sections,
  summary,
  iconFor,
  fallbackProject,
  headingExtra,
}: Readonly<AnalysisSectionsProps<S>>) {
  const [openExtras, setOpenExtras] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setOpenExtras((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {summary}

      {sections.map((section, index) => {
        const Icon = iconFor(section.heading);
        const isFirst = index === 0;
        const isOpen = isFirst || openExtras.has(index);
        return (
          <div
            key={`${index}-${section.heading}`}
            className="border-t pt-3 first:border-t-0 first:pt-0"
          >
            <button
              type="button"
              onClick={() => !isFirst && toggle(index)}
              disabled={isFirst}
              className="flex w-full items-center justify-between gap-2 text-left disabled:cursor-default"
            >
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <Icon className="h-4 w-4 text-muted-foreground" />
                {section.heading}
                {headingExtra?.(section)}
              </h3>
              {!isFirst &&
                (isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ))}
            </button>
            {isOpen && (
              <div className="mt-2">
                <MarkdownRenderer content={section.body} fallbackProject={fallbackProject} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
