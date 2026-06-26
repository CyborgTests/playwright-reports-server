import fs from 'node:fs/promises';

export async function createDirectory(dir: string) {
  const created = await fs.mkdir(dir, { recursive: true });
  if (created) console.log(`[fs] created directory ${dir}`);
}
