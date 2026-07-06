import type { ProjectFilter } from '@playwright-reports/shared';

export function projectFilterMatches(filter: ProjectFilter, project: string): boolean {
  switch (filter.mode) {
    case 'all':
      return true;
    case 'project':
      return filter.name === project;
    case 'regex': {
      try {
        return new RegExp(filter.pattern).test(project);
      } catch (err) {
        console.warn(
          `[notifications] invalid regex "${filter.pattern}" - skipping rule: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        return false;
      }
    }
    default: {
      const _exhaustive: never = filter;
      void _exhaustive;
      return false;
    }
  }
}
