import fs from 'node:fs/promises';
import path from 'node:path';

import { revalidatePath } from 'next/cache';

import { withError } from '@/app/lib/withError';
import { DATA_FOLDER } from '@/app/lib/storage/constants';
import { service } from '@/app/lib/service';
import { JiraService } from '@/app/lib/service/jira';

export const dynamic = 'force-dynamic'; // defaults to auto

const saveFile = async (file: File) => {
  const arrayBuffer = await file.arrayBuffer();

  const buffer = Buffer.from(arrayBuffer);

  await fs.writeFile(path.join(DATA_FOLDER, file.name), buffer, { encoding: 'binary' });
};

const parseHeaderLinks = async (headerLinks: string): Promise<Record<string, string>> => {
  return JSON.parse(headerLinks);
};

export async function PATCH(request: Request) {
  const { result: formData, error: formParseError } = await withError(request.formData());

  if (formParseError) {
    return Response.json({ error: formParseError.message }, { status: 400 });
  }

  if (!formData) {
    return Response.json({ error: 'Form data is missing' }, { status: 400 });
  }

  const logo = formData.get('logo') as File;

  if (logo) {
    const { error: logoError } = await withError(saveFile(logo));

    if (logoError) {
      return Response.json({ error: `failed to save logo: ${logoError?.message}` }, { status: 500 });
    }
  }

  const favicon = formData.get('favicon') as File;

  if (favicon) {
    const { error: faviconError } = await withError(saveFile(favicon));

    if (faviconError) {
      return Response.json({ error: `failed to save favicon: ${faviconError?.message}` }, { status: 500 });
    }
  }

  const title = formData.get('title');
  const logoPath = formData.get('logoPath');
  const faviconPath = formData.get('faviconPath');
  const reporterPaths = formData.get('reporterPaths');
  const headerLinks = formData.get('headerLinks');
  const jiraBaseUrl = formData.get('jiraBaseUrl');
  const jiraEmail = formData.get('jiraEmail');
  const jiraApiToken = formData.get('jiraApiToken');
  const jiraProjectKey = formData.get('jiraProjectKey');
  const resultExpireDays = formData.get('resultExpireDays');
  const resultExpireCronSchedule = formData.get('resultExpireCronSchedule');
  const reportExpireDays = formData.get('reportExpireDays');
  const reportExpireCronSchedule = formData.get('reportExpireCronSchedule');

  const config = await service.getConfig();

  if (!config) {
    return Response.json({ error: `failed to get config` }, { status: 500 });
  }

  if (title !== null) {
    config.title = title.toString();
  }

  if (logo) {
    config.logoPath = `/${logo.name}`;
  } else if (logoPath !== null) {
    config.logoPath = logoPath.toString();
  }

  if (favicon) {
    config.faviconPath = `/${favicon.name}`;
  } else if (faviconPath !== null) {
    config.faviconPath = faviconPath.toString();
  }

  if (reporterPaths !== null) {
    try {
      config.reporterPaths = JSON.parse(reporterPaths.toString());
    } catch {
      config.reporterPaths = [reporterPaths.toString()];
    }
  }

  if (headerLinks) {
    const { result: parsedHeaderLinks, error: parseHeaderLinksError } = await withError(
      parseHeaderLinks(headerLinks.toString()),
    );

    if (parseHeaderLinksError) {
      return Response.json(
        { error: `failed to parse header links: ${parseHeaderLinksError.message}` },
        { status: 400 },
      );
    }

    if (parsedHeaderLinks) config.headerLinks = parsedHeaderLinks;
  }

  if (!config.jira) {
    config.jira = {};
  }

  if (jiraBaseUrl !== null) config.jira.baseUrl = jiraBaseUrl.toString();
  if (jiraEmail !== null) config.jira.email = jiraEmail.toString();
  if (jiraApiToken !== null) config.jira.apiToken = jiraApiToken.toString();
  if (jiraProjectKey !== null) config.jira.projectKey = jiraProjectKey.toString();

  if (jiraBaseUrl || jiraEmail || jiraApiToken || jiraProjectKey) {
    JiraService.resetInstance();
  }

  if (!config.cron) {
    config.cron = {};
  }

  if (resultExpireDays !== null) {
    config.cron.resultExpireDays = parseInt(resultExpireDays.toString());
  }
  if (resultExpireCronSchedule !== null) {
    config.cron.resultExpireCronSchedule = resultExpireCronSchedule.toString();
  }
  if (reportExpireDays !== null) {
    config.cron.reportExpireDays = parseInt(reportExpireDays.toString());
  }
  if (reportExpireCronSchedule !== null) {
    config.cron.reportExpireCronSchedule = reportExpireCronSchedule.toString();
  }

  const { error: saveConfigError } = await withError(service.updateConfig(config));

  if (saveConfigError) {
    return Response.json({ error: `failed to save config: ${saveConfigError.message}` }, { status: 500 });
  }

  revalidatePath('/', 'layout');
  revalidatePath('/login', 'layout');

  return Response.json({ message: 'config saved' });
}

export async function GET() {
  const config = await service.getConfig();

  if (!config) {
    return Response.json({ error: 'Config not found' }, { status: 404 });
  }

  // Add authRequired flag to config response
  const authRequired = !!process.env.API_TOKEN;

  return Response.json({ ...config, authRequired }, { status: 200 });
}
