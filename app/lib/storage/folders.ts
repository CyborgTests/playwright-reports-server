import fs from 'node:fs/promises';

export async function createDirectory(dir: string) {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    console.log('Created directory:', dir);
  }
}
