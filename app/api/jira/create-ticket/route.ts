import { withError } from '@/app/lib/withError';
import { JiraService } from '@/app/lib/service/jira';

export const dynamic = 'force-dynamic';

interface CreateTicketRequest {
  summary: string;
  description: string;
  issueType: string;
  projectKey: string;
  testId: string;
  testTitle: string;
  testOutcome: string;
  testLocation: {
    file: string;
    line: number;
    column: number;
  };
  testAttachments?: Array<{
    name: string;
    path: string;
    contentType: string;
  }>;
  reportId?: string;
}

export async function POST(request: Request) {
  const { result: data, error: parseError } = await withError(request.json());

  if (parseError) {
    return Response.json({ error: parseError.message }, { status: 400 });
  }

  if (!data) {
    return Response.json({ error: 'Request data is missing' }, { status: 400 });
  }

  const ticketData = data as CreateTicketRequest;

  // Add project name and reportId prefix to attachment paths since they are relative to the report folder
  if (ticketData.reportId) {
    ticketData.testAttachments = ticketData.testAttachments?.map((att) => ({
      ...att,
      path: `Fail/${ticketData.reportId}/${att.path}`,
    }));
  } else {
    console.error('reportId is missing from ticketData');
  }

  try {
    if (!ticketData.summary || !ticketData.projectKey) {
      return Response.json(
        {
          error: 'Summary and project key are required',
        },
        { status: 400 },
      );
    }

    const jiraService = JiraService.getInstance();

    const jiraResponse = await jiraService.createIssue(
      ticketData.summary,
      ticketData.description,
      ticketData.issueType,
      ticketData.projectKey,
      {
        testId: ticketData.testId,
        testTitle: ticketData.testTitle,
        testOutcome: ticketData.testOutcome,
        testLocation: ticketData.testLocation,
      },
      ticketData.testAttachments,
    );

    return Response.json(
      {
        success: true,
        issueKey: jiraResponse.key,
        issueId: jiraResponse.id,
        issueUrl: jiraResponse.self,
        message: 'Jira ticket created successfully',
        data: {
          ...ticketData,
          issueKey: jiraResponse.key,
          issueId: jiraResponse.id,
          issueUrl: jiraResponse.self,
          created: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('Failed to create Jira ticket:', error);

    if (error instanceof Error && error.message.includes('Jira configuration is incomplete')) {
      return Response.json(
        {
          error:
            'Jira is not configured. Please set up JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
        },
        { status: 500 },
      );
    }

    return Response.json(
      {
        error: `Failed to create Jira ticket: ${error instanceof Error ? error.message : 'Unknown error'}`,
      },
      { status: 500 },
    );
  }
}
