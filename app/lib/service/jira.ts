import { env } from '@/app/config/env';
import { JiraConfig } from '@/app/types';

export interface JiraIssueFields {
  summary: string;
  description:
    | string
    | {
        type: string;
        version: number;
        content: Array<{
          type: string;
          content: Array<{
            type: string;
            text: string;
          }>;
        }>;
      };
  issuetype: { name?: string; id?: string };
  project: { key: string };
  [key: string]: any;
}

export interface JiraCreateIssueRequest {
  fields: JiraIssueFields;
}

export interface JiraCreateIssueResponse {
  id: string;
  key: string;
  self: string;
}

export interface JiraErrorResponse {
  errorMessages: string[];
  errors: Record<string, string>;
}

const initiatedJira = Symbol.for('playwright.reports.jira');
const instance = globalThis as typeof globalThis & { [initiatedJira]?: JiraService };

export class JiraService {
  private static instance: JiraService;
  private baseUrl: string;
  private auth: string;

  private constructor(jiraConfig?: JiraConfig) {
    // Use config if provided, otherwise fall back to environment variables
    const config = jiraConfig || {
      baseUrl: env.JIRA_BASE_URL,
      email: env.JIRA_EMAIL,
      apiToken: env.JIRA_API_TOKEN,
      projectKey: env.JIRA_PROJECT_KEY,
    };

    this.baseUrl = config.baseUrl || '';
    const email = config.email || '';
    const apiToken = config.apiToken || '';

    if (!this.baseUrl || !email || !apiToken) {
      throw new Error(
        'Jira configuration is incomplete. Please configure Jira settings in the admin panel or set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables.',
      );
    }

    this.auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  public static getInstance(jiraConfig?: JiraConfig): JiraService {
    instance[initiatedJira] ??= new JiraService(jiraConfig);

    return instance[initiatedJira];
  }

  public static resetInstance(): void {
    instance[initiatedJira] = undefined;
    JiraService.instance = undefined as any;
  }

  private async makeRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: any,
  ): Promise<T> {
    const url = `${this.baseUrl}/rest/api/3${endpoint}`;

    const headers: Record<string, string> = {
      Authorization: `Basic ${this.auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    const requestOptions: RequestInit = {
      method,
      headers,
    };

    if (body) {
      requestOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, requestOptions);

    if (!response.ok) {
      const errorData = (await response.json()) as JiraErrorResponse;
      const errorMessage =
        errorData.errorMessages?.join(', ') ||
        Object.values(errorData.errors || {}).join(', ') ||
        `HTTP ${response.status}: ${response.statusText}`;

      throw new Error(`Jira API error: ${errorMessage}`);
    }

    return response.json() as T;
  }

  public async createIssue(
    summary: string,
    description: string,
    issueType: string,
    projectKey: string,
    testInfo?: {
      testId: string;
      testTitle: string;
      testOutcome: string;
      testLocation: {
        file: string;
        line: number;
        column: number;
      };
    },
    attachments?: Array<{
      name: string;
      path: string;
      contentType: string;
    }>,
  ): Promise<JiraCreateIssueResponse> {
    const issueTypes = await this.getIssueTypes(projectKey);

    let availableIssueTypes = issueTypes;

    try {
      const project = await this.getProject(projectKey);

      if (project.issueTypes && project.issueTypes.length > 0) {
        availableIssueTypes = project.issueTypes;
      }
    } catch {
      console.warn(`Could not fetch project-specific issue types for ${projectKey}, using global issue types`);
    }

    const issueTypeObj = availableIssueTypes.find((it: any) => it.name === issueType);

    if (!issueTypeObj) {
      throw new Error(
        `Issue type '${issueType}' not found. Available issue types: ${availableIssueTypes.map((it: any) => it.name).join(', ')}`,
      );
    }

    const fields: JiraIssueFields = {
      summary,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: description,
              },
            ],
          },
        ],
      },
      issuetype: { id: issueTypeObj.id },
      project: { key: projectKey },
    };

    if (testInfo) {
      const testInfoText = `
        Test Information:
        - Test ID: ${testInfo.testId}
        - Test Title: ${testInfo.testTitle}
        - Test Outcome: ${testInfo.testOutcome}
        - File Location: ${testInfo.testLocation.file}:${testInfo.testLocation.line}:${testInfo.testLocation.column}
      `;

      if (typeof fields.description === 'string') {
        fields.description += testInfoText;
      } else if (fields.description.content && fields.description.content[0]) {
        fields.description.content[0].content.push({
          type: 'text',
          text: testInfoText,
        });
      }
    }

    const requestBody: JiraCreateIssueRequest = {
      fields,
    };

    console.log('Jira request body:', JSON.stringify(requestBody, null, 2));

    const issueResponse = await this.makeRequest<JiraCreateIssueResponse>('/issue', 'POST', requestBody);

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        await this.addAttachment(issueResponse.key, attachment);
      }
    }

    return issueResponse;
  }

  public async getProject(projectKey: string): Promise<any> {
    return this.makeRequest(`/project/${projectKey}`);
  }

  public async getIssueTypes(projectKey: string): Promise<any> {
    return this.makeRequest(`/project/${projectKey}`);
  }

  public async addAttachment(
    issueKey: string,
    attachment: {
      name: string;
      path: string;
      contentType: string;
    },
  ): Promise<any> {
    try {
      const { storage } = await import('@/app/lib/storage');

      let fileName = attachment.name;

      if (!fileName.includes('.')) {
        const extension = attachment.contentType.split('/')[1];

        if (extension) {
          fileName = `${fileName}.${extension}`;
        }
      }

      const fileContent = await storage.readFile(attachment.path, attachment.contentType);

      const fileBuffer = typeof fileContent === 'string' ? Buffer.from(fileContent, 'utf-8') : fileContent;

      const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2)}`;

      const formData = Buffer.concat([
        Buffer.from(`--${boundary}\r\n`),
        Buffer.from(`Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`),
        Buffer.from(`Content-Type: ${attachment.contentType}\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const attachmentUrl = `${this.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;

      const response = await fetch(attachmentUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.auth}`,
          'X-Atlassian-Token': 'no-check',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();

        throw new Error(
          `Failed to attach file to JIRA issue: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const result = await response.json();

      console.log(`Successfully attached ${attachment.name} to issue ${issueKey}`);

      return result;
    } catch (error) {
      console.error(`Error attaching file ${attachment.name} to issue ${issueKey}:`, error);
      throw error;
    }
  }
}
