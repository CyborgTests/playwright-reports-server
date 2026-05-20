import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.config', 'pwrs-cli');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  server?: string;
  token?: string;
}

export interface ResolvedConfig {
  server: string;
  token?: string;
}

export function readConfigFile(): CliConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as CliConfig;
  } catch {
    return {};
  }
}

export function writeConfigFile(next: CliConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

/**
 * Resolve the runtime config from (in order): env vars, then config file.
 * Env always wins so CI / one-off shells can override without touching the
 * persisted config.
 */
export function resolveConfig(): ResolvedConfig {
  const file = readConfigFile();
  const server = process.env.PRS_SERVER_URL ?? file.server;
  const token = process.env.PRS_API_TOKEN ?? file.token;
  if (!server) {
    throw new CliConfigError(
      'No server URL configured. Set PRS_SERVER_URL or run: pwrs-cli config set server <url>'
    );
  }
  return { server: stripTrailingSlash(server), token };
}

export function configPath(): string {
  return CONFIG_PATH;
}

export class CliConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliConfigError';
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
