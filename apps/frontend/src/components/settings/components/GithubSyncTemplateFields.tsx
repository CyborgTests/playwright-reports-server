import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface RegexInfo {
  ok: boolean;
  error?: string;
  captureCount: number;
  sampleArtifact: string;
  sampleMatches: string[];
}

function analyzeRegex(pattern: string): RegexInfo {
  if (!pattern.trim()) {
    return { ok: false, error: 'empty', captureCount: 0, sampleArtifact: '', sampleMatches: [] };
  }
  try {
    const re = new RegExp(pattern);
    // Count capture groups via the source — RegExp doesn't expose it directly.
    // Subtract non-capturing `(?:` and lookarounds `(?=`, `(?!`, `(?<=`, `(?<!`.
    const all = (pattern.match(/\((?!\?)/g) ?? []).length;
    const sample = sampleArtifactFor(pattern, re);
    const matchResult = sample ? sample.match(re) : null;
    return {
      ok: true,
      captureCount: all,
      sampleArtifact: sample,
      sampleMatches: matchResult ? Array.from(matchResult) : [],
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'invalid',
      captureCount: 0,
      sampleArtifact: '',
      sampleMatches: [],
    };
  }
}

/** Best-effort sample string the user might recognize. Tries a few common
 *  artifact names so the preview shows real-looking values for common patterns. */
function sampleArtifactFor(_pattern: string, re: RegExp): string {
  const candidates = [
    'playwright-report-chrome',
    'playwright-report-firefox',
    'playwright-report',
    'e2e-staging-report',
    'e2e-production-report',
    'report-shard-1',
    'test-results',
  ];
  for (const c of candidates) {
    if (re.test(c)) return c;
  }
  return '';
}

function renderTemplate(template: string, ctx: Record<string, string>, matches: string[]): string {
  return template.replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    if (/^match\d+$/.test(key)) {
      const idx = Number.parseInt(key.slice(5), 10);
      return matches[idx] ?? '';
    }
    return ctx[key] ?? '';
  });
}

interface GithubSyncTemplateFieldsProps {
  artifactPattern: string;
  projectTemplate: string;
  titleTemplate: string;
  repo: string;
  workflow: string;
  onChange: (
    patch: Partial<{ artifactPattern: string; projectTemplate: string; titleTemplate: string }>
  ) => void;
}

export function GithubSyncTemplateFields({
  artifactPattern,
  projectTemplate,
  titleTemplate,
  repo,
  workflow,
  onChange,
}: Readonly<GithubSyncTemplateFieldsProps>) {
  const regexInfo = analyzeRegex(artifactPattern);
  const previewCtx: Record<string, string> = {
    branch: 'main',
    runDate: new Date().toISOString().slice(0, 10),
    runId: '1234567890',
    artifactName: regexInfo.sampleArtifact || '(no match)',
    repo: repo || 'owner/name',
    workflowFile: workflow || 'workflow.yml',
    workflowName: 'Playwright Tests',
  };
  const projectPreview = renderTemplate(projectTemplate, previewCtx, regexInfo.sampleMatches);
  const titlePreview = renderTemplate(titleTemplate, previewCtx, regexInfo.sampleMatches);

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="gs-pattern">Artifact name regex</Label>
        <Input
          id="gs-pattern"
          value={artifactPattern}
          onChange={(e) => onChange({ artifactPattern: e.target.value })}
          placeholder="^playwright-report-(.+)$"
        />
        <p className="text-xs text-muted-foreground">
          Filters which workflow artifacts get uploaded. Use parentheses to capture parts of the
          artifact name — those captures become <span className="font-mono">{`$\{match1}`}</span>,{' '}
          <span className="font-mono">{`$\{match2}`}</span>, … in the templates below.
        </p>
        {artifactPattern && !regexInfo.ok && (
          <p className="text-xs text-destructive">Invalid regex: {regexInfo.error}</p>
        )}
        {regexInfo.ok && (
          <p className="text-xs text-muted-foreground">
            {regexInfo.captureCount === 0 ? (
              <>No capture groups detected — add parentheses to capture parts of the name.</>
            ) : (
              <>
                {regexInfo.captureCount} capture group
                {regexInfo.captureCount > 1 ? 's' : ''} available:{' '}
                {Array.from({ length: regexInfo.captureCount }).map((_, i) => {
                  const name = `match${i + 1}`;
                  return (
                    <span key={name}>
                      {i > 0 && ', '}
                      <span className="font-mono">{`$\{${name}}`}</span>
                    </span>
                  );
                })}
              </>
            )}
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-md border p-3 bg-muted/30">
        <div>
          <h4 className="text-sm font-medium">Naming for synced reports</h4>
          <p className="text-xs text-muted-foreground">
            These templates build the <span className="font-medium">project name</span> (used to
            group reports in the dashboard) and the <span className="font-medium">title</span>{' '}
            (shown on each report) for every artifact this sync uploads. Mix literal text with{' '}
            <span className="font-mono">{`$\{placeholder}`}</span> tokens.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="gs-project">Project name template</Label>
            <Input
              id="gs-project"
              value={projectTemplate}
              onChange={(e) => onChange({ projectTemplate: e.target.value })}
              placeholder="${match1}:${branch}"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gs-title">Report title template</Label>
            <Input
              id="gs-title"
              value={titleTemplate}
              onChange={(e) => onChange({ titleTemplate: e.target.value })}
              placeholder="${runDate}"
            />
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-xs font-medium">Available placeholders</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc pl-4">
            <li>
              <span className="font-mono">{`$\{match1}`}</span>,{' '}
              <span className="font-mono">{`$\{match2}`}</span>, … — capture groups from the regex
              above (e.g. the part in parentheses)
            </li>
            <li>
              <span className="font-mono">{`$\{branch}`}</span> — git branch the workflow ran on
            </li>
            <li>
              <span className="font-mono">{`$\{runDate}`}</span> — date the workflow ran
              (YYYY-MM-DD)
            </li>
            <li>
              <span className="font-mono">{`$\{workflowName}`}</span> — display name of the workflow
              (e.g. "Playwright Tests")
            </li>
            <li>
              <span className="font-mono">{`$\{workflowFile}`}</span> — workflow file name (e.g.
              "playwright.yml")
            </li>
            <li>
              <span className="font-mono">{`$\{runId}`}</span>,{' '}
              <span className="font-mono">{`$\{artifactName}`}</span>,{' '}
              <span className="font-mono">{`$\{repo}`}</span>
            </li>
          </ul>
        </div>

        <div className="space-y-1 border-t pt-2">
          <p className="text-xs font-medium">Preview</p>
          {regexInfo.ok && regexInfo.sampleArtifact ? (
            <div className="text-xs space-y-0.5 font-mono">
              <div className="text-muted-foreground">artifact: {regexInfo.sampleArtifact}</div>
              <div>
                <span className="text-muted-foreground">project →</span>{' '}
                <span className="font-medium">{projectPreview || '(empty)'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">title →</span>{' '}
                <span className="font-medium">{titlePreview || '(empty)'}</span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Enter a valid regex above to see a worked example.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
