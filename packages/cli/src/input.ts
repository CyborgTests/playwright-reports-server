import { readFile } from 'node:fs/promises';

export async function readTextInput(
  source: string | undefined,
  opts: { label: string }
): Promise<string> {
  if (!source) {
    throw new Error(`--${opts.label}-file is required (pass a path or '-' for stdin)`);
  }
  const text = source === '-' ? await readStdin() : await readFile(source, 'utf8');
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(
      `--${opts.label}-file ${source === '-' ? '(stdin)' : source} is empty after trimming`
    );
  }
  return trimmed;
}

export async function readJsonInput<T>(
  source: string | undefined,
  opts: { label: string }
): Promise<T | undefined> {
  if (!source) return undefined;
  const text = source === '-' ? await readStdin() : await readFile(source, 'utf8');
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const where = source === '-' ? 'stdin' : source;
    throw new Error(
      `--${opts.label}-file ${where} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}
