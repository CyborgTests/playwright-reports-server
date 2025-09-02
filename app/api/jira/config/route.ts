import { JiraService } from '@/app/lib/service/jira';
import { service } from '@/app/lib/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = await service.getConfig();
    const jiraConfig = config.jira;

    const isConfigured = !!(jiraConfig?.baseUrl && jiraConfig?.email && jiraConfig?.apiToken);

    if (!isConfigured) {
      return Response.json({
        configured: false,
        message: 'Jira is not configured. Please configure Jira settings in the admin panel.',
        config: jiraConfig || {},
      });
    }

    const jiraService = JiraService.getInstance(jiraConfig);

    let issueTypes = [];

    if (jiraConfig?.projectKey) {
      try {
        const project = await jiraService.getProject(jiraConfig.projectKey);

        issueTypes = project.issueTypes || [];
      } catch (error) {
        console.warn(`Could not fetch project-specific issue types for ${jiraConfig.projectKey}:`, error);
      }
    }

    return Response.json({
      configured: true,
      baseUrl: jiraConfig.baseUrl,
      defaultProjectKey: jiraConfig.projectKey,
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
