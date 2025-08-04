import fs from 'node:fs/promises';
import path from 'node:path';

import { revalidatePath } from 'next/cache';

import { withError } from '@/app/lib/withError';
import { DATA_FOLDER } from '@/app/lib/storage/constants';
import { service } from '@/app/lib/service';

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
  const headerLinks = formData.get('headerLinks');

  const config = await service.getConfig();

  if (!config) {
    return Response.json({ error: `failed to get config` }, { status: 500 });
  }

  if (title) config.title = title.toString();

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

  if (logo) config.logoPath = `/${logo.name}`;
  if (favicon) config.faviconPath = `/${favicon.name}`;

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

  return Response.json(config, { status: 200 });
}
