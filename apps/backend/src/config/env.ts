import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { cleanEnv, num, str } from 'envalid';
import type { LLMProviderType } from '../lib/llm/types';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const envPaths = [
  join(__dirname, '../../../../.env'), //backend dist folder
  join(process.cwd(), '.env'), // working directory
  '/app/.env', // app root in Docker
];

for (const envPath of envPaths) {
  try {
    config({ path: envPath });
    break;
  } catch {
    // Continue to next path if this one doesn't exist
  }
}

export const env = cleanEnv(process.env, {
  PORT: num({ desc: 'Port to run the server on', default: 3001 }),
  HOST: str({ desc: 'Host to run the server on', default: '0.0.0.0' }),
  API_BASE_PATH: str({ desc: 'Base path for the API', default: '' }),
  API_TOKEN: str({ desc: 'API token for authorization', default: undefined }),
  UI_AUTH_EXPIRE_HOURS: str({
    desc: 'How much hours are allowed to keep auth session valid',
    default: '2',
  }),
  AUTH_SECRET: str({ desc: 'Secret for JWT', default: undefined }),
  DATA_STORAGE: str({ desc: 'Where to store data', default: 'fs' }),
  // s3
  S3_ENDPOINT: str({ desc: 'S3 endpoint', default: undefined }),
  S3_ACCESS_KEY: str({ desc: 'S3 access key', default: undefined }),
  S3_SECRET_KEY: str({ desc: 'S3 secret key', default: undefined }),
  S3_PORT: num({ desc: 'S3 port', default: undefined }),
  S3_REGION: str({ desc: 'S3 region', default: undefined }),
  S3_BUCKET: str({ desc: 'S3 bucket', default: 'playwright-reports-server' }),
  S3_BATCH_SIZE: num({ desc: 'S3 batch size', default: 10 }),
  S3_MULTIPART_CHUNK_SIZE_MB: num({
    desc: 'S3 multipart upload chunk size in MB',
    default: 25,
  }),
  // cleanup task
  RESULT_EXPIRE_DAYS: num({
    desc: 'How much days to keep results',
    default: undefined,
  }),
  RESULT_EXPIRE_CRON_SCHEDULE: str({
    desc: 'Cron schedule for results cleanup',
    default: '33 3 * * *',
  }),
  REPORT_EXPIRE_DAYS: num({
    desc: 'How much days to keep reports',
    default: undefined,
  }),
  REPORT_EXPIRE_CRON_SCHEDULE: str({
    desc: 'Cron schedule for reports cleanup',
    default: '44 4 * * *',
  }),
  // LLM
  LLM_ENABLED: str({ desc: 'Enable LLM features', default: 'false' }),
  LLM_PROVIDER: str<LLMProviderType>({
    desc: 'LLM provider (openai, anthropic)',
    default: 'openai',
    choices: ['openai', 'anthropic'],
  }),
  LLM_BASE_URL: str({ desc: 'LLM base URL', default: undefined }),
  LLM_API_KEY: str({ desc: 'LLM API key', default: undefined }),
  LLM_MODEL: str({
    desc: 'LLM model name, by default will take some model from /models endpoint',
    default: undefined,
  }),
  LLM_MAX_TOKENS: num({
    desc: 'Max output tokens. OpenAI/local omit when unset; Anthropic falls back to a safe default.',
    default: undefined,
  }),
  LLM_CONTEXT_WINDOW: num({
    desc: 'Override detected model context window (tokens). Useful for local models that do not advertise it via /models.',
    default: undefined,
  }),
  LLM_PARALLEL_REQUESTS: num({ desc: 'Number of parallel LLM requests', default: 1 }),
  LLM_STRUCTURED_OUTPUT_MODE: str({
    desc: 'How to request structured output: auto (try; fall back to text on unsupported), force (require), disabled (always text).',
    default: 'auto',
    choices: ['auto', 'force', 'disabled'],
  }),
  LLM_MULTIMODAL_MODE: str({
    desc: 'How to attach screenshots for visual failures: auto (try; fall back on unsupported), force (require), disabled (never attach images).',
    default: 'auto',
    choices: ['auto', 'force', 'disabled'],
  }),
  // Test management
  TEST_FLAKINESS_QUARANTINE_THRESHOLD: num({
    desc: 'Flakiness percentage threshold for quarantine (default: 5%)',
    default: 5,
  }),
  TEST_FLAKINESS_WARNING_THRESHOLD: num({
    desc: 'Flakiness percentage threshold for warning (default: 2%)',
    default: 2,
  }),
  TEST_FLAKINESS_AUTO_QUARANTINE: str({
    desc: 'Enable automatic quarantine for flaky tests',
    default: 'false',
    choices: ['true', 'false'],
  }),
  TEST_FLAKINESS_MIN_RUNS: num({
    desc: 'Minimum number of runs before calculating flakiness',
    default: 1,
  }),
  TEST_FLAKINESS_EVALUATION_WINDOW_DAYS: num({
    desc: 'Number of days to consider for flakiness calculation',
    default: 30,
  }),
});
