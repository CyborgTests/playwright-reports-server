import { JiraService } from '@/app/lib/service/jira';
import { env } from '@/app/config/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const isConfigured = !!(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN);

    if (!isConfigured) {
      return Response.json({
        configured: false,
        message:
          'Jira is not configured. Please set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
        requiredEnvVars: ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN'],
      });
    }

    const jiraService = JiraService.getInstance();

    let issueTypes = null;

    if (env.JIRA_PROJECT_KEY) {
      try {
        const project = await jiraService.getProject(env.JIRA_PROJECT_KEY);

        issueTypes = project.issueTypes || [];
      } catch (error) {
        console.warn(`Could not fetch project-specific issue types for ${env.JIRA_PROJECT_KEY}:`, error);
      }
    }

    return Response.json({
      configured: true,
      baseUrl: env.JIRA_BASE_URL,
      defaultProjectKey: env.JIRA_PROJECT_KEY,
      issueTypes: issueTypes.map((type: any) => ({
        id: type.id,
        name: type.name,
        description: type.description,
      })),
    });
  } catch (error) {
    return Response.json(
      {
        configured: false,
        error: `Failed to connect to Jira: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 },
    );
  }
}
