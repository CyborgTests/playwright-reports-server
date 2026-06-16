import type { ProjectFilter } from '@playwright-reports/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProjectSearchInput } from './ProjectSearchInput';

interface ProjectFilterEditorProps {
  filter: ProjectFilter;
  onChange: (filter: ProjectFilter) => void;
}

export function ProjectFilterEditor({ filter, onChange }: Readonly<ProjectFilterEditorProps>) {
  return (
    <div className="space-y-2">
      <Label>Project filter</Label>
      {filter.mode === 'regex' ? (
        <>
          <div className="flex gap-2">
            <Input
              value={filter.pattern}
              onChange={(e) => onChange({ mode: 'regex', pattern: e.target.value })}
              placeholder="^(checkout|payments)-e2e$"
              maxLength={500}
              className="font-mono flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ mode: 'all' })}
            >
              Back to projects
            </Button>
          </div>
          <RegexHint pattern={filter.pattern} />
        </>
      ) : (
        <ProjectSearchInput
          value={filter.mode === 'all' ? '' : filter.name}
          mode={filter.mode}
          onPickProject={(name) => onChange({ mode: 'project', name })}
          onPickAll={() => onChange({ mode: 'all' })}
          onPickRegex={() => onChange({ mode: 'regex', pattern: '' })}
        />
      )}
    </div>
  );
}

function RegexHint({ pattern }: Readonly<{ pattern: string }>) {
  if (!pattern) return null;
  let ok = false;
  let err = '';
  try {
    void new RegExp(pattern);
    ok = true;
  } catch (e) {
    err = e instanceof Error ? e.message : 'Invalid regex';
  }
  return (
    <p className={`text-xs ${ok ? 'text-muted-foreground' : 'text-danger'}`}>
      {ok ? 'Pattern compiles.' : `Invalid regex: ${err}`}
    </p>
  );
}
