import { configPath, readConfigFile, writeConfigFile } from '../config.js';
import { emitJson } from '../format.js';

const KEYS = ['server', 'token'] as const;
type Key = (typeof KEYS)[number];

function isKey(value: string): value is Key {
  return (KEYS as readonly string[]).includes(value);
}

export async function runConfigCommand(args: string[]): Promise<void> {
  const [action, key, value] = args;
  if (!action) {
    showHelp();
    return;
  }

  if (action === 'set') {
    if (!key || !isKey(key) || value === undefined) {
      throw new Error(`Usage: pwrs-cli config set <${KEYS.join('|')}> <value>`);
    }
    const current = readConfigFile();
    writeConfigFile({ ...current, [key]: value });
    emitJson({ ok: true, key, path: configPath() });
    return;
  }

  if (action === 'get') {
    const current = readConfigFile();
    if (!key) {
      // Mask the token so the value is safe to print in transcripts.
      emitJson({
        server: current.server ?? null,
        token: current.token ? `${current.token.slice(0, 4)}…` : null,
        path: configPath(),
      });
      return;
    }
    if (!isKey(key)) {
      throw new Error(`Unknown key: ${key}. Valid keys: ${KEYS.join(', ')}`);
    }
    emitJson({ [key]: current[key] ?? null });
    return;
  }

  throw new Error(`Unknown config action: ${action}. Valid: set, get`);
}

function showHelp(): void {
  process.stdout.write(
    [
      'pwrs-cli config — manage CLI configuration',
      '',
      'Usage:',
      '  pwrs-cli config set server <url>     Save the Playwright Reports Server URL',
      '  pwrs-cli config set token <token>    Save the API token',
      '  pwrs-cli config get                  Show current config (token masked)',
      '  pwrs-cli config get <server|token>   Show a single value',
      '',
      'Environment overrides (always win over saved config):',
      '  PRS_SERVER_URL                       Server URL',
      '  PRS_API_TOKEN                        API token',
      '',
    ].join('\n')
  );
}
