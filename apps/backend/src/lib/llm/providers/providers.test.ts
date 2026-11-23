import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { LLM_PROVIDER_TYPES, type LLMProviderType } from '@playwright-reports/shared';
import { createProvider, llmService } from '../index.js';
import type { LLMProviderConfig, SegmentedPrompt } from '../types/index.js';
import { AnthropicProvider } from './anthropic.js';
import { CursorProvider } from './cursor.js';
import { OpenAIProvider } from './openai.js';

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace fetch with a router keyed by "METHOD url"; records every call. */
function mockFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const url = String(input);
    calls.push({
      method,
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const handler = routes[`${method} ${url}`];
    return handler ? handler() : json({ error: 'not mocked' }, 404);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function config(provider: LLMProviderType, baseUrl: string, model = 'm'): LLMProviderConfig {
  return {
    provider,
    baseUrl,
    apiKey: 'secret',
    model,
    requestTimeoutMs: 5_000,
    maxRetries: 0,
    retryDelayMs: 0,
  };
}

const okChat = () =>
  json({ model: 'm', choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });

const prompt: SegmentedPrompt = {
  segments: [
    { id: 'sys', role: 'system', stable: true, content: 'You are a test analyst.' },
    {
      id: 'u',
      role: 'user',
      stable: false,
      content: 'Why did it fail?',
      images: [{ data: 'aGk=', mediaType: 'image/png' }],
    },
  ],
};

describe('createProvider', () => {
  const expected: Record<LLMProviderType, unknown> = {
    openai: OpenAIProvider,
    anthropic: AnthropicProvider,
    cursor: CursorProvider,
  };

  for (const type of LLM_PROVIDER_TYPES) {
    it(`builds ${type}`, () => {
      const provider = createProvider(config(type, 'https://x'));
      assert.equal(provider.constructor, expected[type]);
    });
  }

  it('throws on an unknown provider instead of falling back to OpenAI', () => {
    assert.throws(
      () => createProvider(config('nope' as LLMProviderType, 'https://x')),
      /Unknown LLM provider: nope/
    );
  });
});

describe('OpenAI-compatible (regression)', () => {
  it('test-connection GETs /models then pings /chat/completions with Bearer only', async () => {
    const base = 'https://openrouter.ai/api/v1';
    const calls = mockFetch({
      [`GET ${base}/models`]: () => json({ data: [{ id: 'm' }] }),
      [`POST ${base}/chat/completions`]: okChat,
    });
    const res = await llmService.testConnection(config('openai', base));
    assert.equal(res.success, true, res.error);
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [`GET ${base}/models`, `POST ${base}/chat/completions`]
    );
    assert.deepEqual(calls[1].body, {
      model: 'm',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      temperature: 0,
    });
    assert.equal(calls[1].headers['api-key'], undefined);
  });
});

describe('Cursor', () => {
  const api = 'https://api.cursor.com';
  CursorProvider.pollIntervalMs = 0;

  it('discovers models from items[] and does not double /v1', async () => {
    mockFetch({
      [`GET ${api}/v1/models`]: () =>
        json({ items: [{ id: 'auto-smart', displayName: 'Auto' }, { id: 'composer-2.5' }] }),
    });
    const res = await llmService.discoverModels({
      provider: 'cursor',
      baseUrl: `${api}/v1/`,
      apiKey: 'crsr_x',
    });
    assert.equal(res.success, true, res.error);
    assert.deepEqual(res.models, [
      { id: 'auto-smart', name: 'Auto' },
      { id: 'composer-2.5', name: undefined },
    ]);
  });

  it('test-connection checks /v1/me and the model id, never /chat/completions', async () => {
    const calls = mockFetch({
      [`GET ${api}/v1/me`]: () => json({ apiKeyName: 'k', createdAt: '2026-01-01' }),
      [`GET ${api}/v1/models`]: () => json({ items: [{ id: 'auto-smart' }] }),
    });
    const ok = await llmService.testConnection(config('cursor', api, 'auto-smart'));
    assert.equal(ok.success, true, ok.error);
    const bad = await llmService.testConnection(config('cursor', api, 'gpt-nope'));
    assert.equal(bad.success, false);
    assert.ok(calls.every((c) => !c.url.includes('chat/completions')));
  });

  it('fails test-connection closed on 401', async () => {
    mockFetch({ [`GET ${api}/v1/me`]: () => json({ code: 'unauthorized' }, 401) });
    const res = await llmService.testConnection(config('cursor', api, 'auto-smart'));
    assert.equal(res.success, false);
  });

  it('runs a no-repo agent, returns run.result, and deletes the agent', async () => {
    let polls = 0;
    const calls = mockFetch({
      [`POST ${api}/v1/agents`]: () =>
        json(
          { agent: { id: 'bc-1' }, run: { id: 'run-1', agentId: 'bc-1', status: 'CREATING' } },
          201
        ),
      [`GET ${api}/v1/agents/bc-1/runs/run-1`]: () =>
        json(
          ++polls < 2
            ? { id: 'run-1', status: 'RUNNING' }
            : { id: 'run-1', status: 'FINISHED', result: 'Selector changed.' }
        ),
      [`DELETE ${api}/v1/agents/bc-1`]: () => json({ id: 'bc-1' }),
    });

    const res = await createProvider(config('cursor', api, 'auto-smart')).sendSegmentedMessage(
      prompt
    );

    assert.equal(res.content, 'Selector changed.');
    assert.ok(res.usage.inputTokens > 0);
    assert.deepEqual(calls[0].body, {
      prompt: {
        text: 'You are a test analyst.\n\nWhy did it fail?',
        images: [{ data: 'aGk=', mimeType: 'image/png' }],
      },
      model: { id: 'auto-smart' },
    });
    assert.equal(calls[0].headers.Authorization, 'Bearer secret');
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url.replace(api, '')}`),
      [
        'POST /v1/agents',
        'GET /v1/agents/bc-1/runs/run-1',
        'GET /v1/agents/bc-1/runs/run-1',
        'DELETE /v1/agents/bc-1',
      ]
    );
  });

  it('throws when the run ends without FINISHED', async () => {
    mockFetch({
      [`POST ${api}/v1/agents`]: () =>
        json({ agent: { id: 'bc-2' }, run: { id: 'run-2', status: 'ERROR' } }, 201),
    });
    await assert.rejects(
      createProvider(config('cursor', api)).sendSegmentedMessage(prompt),
      /status ERROR/
    );
  });
  it('fails on an HTTP error from POST /v1/agents', async () => {
    mockFetch({ [`POST ${api}/v1/agents`]: () => json({ code: 'unauthorized' }, 401) });
    await assert.rejects(createProvider(config('cursor', api)).sendSegmentedMessage(prompt), {
      code: 'authentication',
    });
  });

  it('throws when the run is FINISHED but has no result', async () => {
    mockFetch({
      [`POST ${api}/v1/agents`]: () =>
        json({ agent: { id: 'bc-3' }, run: { id: 'run-3', status: 'FINISHED' } }, 201),
    });
    await assert.rejects(
      createProvider(config('cursor', api)).sendSegmentedMessage(prompt),
      /status FINISHED and no result/
    );
  });

  it('omits images and model when absent, trims images to 5, sums tokens', async () => {
    const finished = () =>
      json({ agent: { id: 'bc-4' }, run: { id: 'r', status: 'FINISHED', result: 'ok' } }, 201);
    const calls = mockFetch({ [`POST ${api}/v1/agents`]: finished });
    const provider = createProvider(config('cursor', `${api}//`, ''));

    const res = await provider.sendSegmentedMessage({ segments: [prompt.segments[0]] });
    assert.deepEqual(calls[0].body, { prompt: { text: 'You are a test analyst.' } });
    assert.equal(calls[0].url, `${api}/v1/agents`);
    assert.equal(res.model, 'cursor-default');
    assert.equal(res.usage.totalTokens, res.usage.inputTokens + res.usage.outputTokens);

    const img = { data: 'aGk=', mediaType: 'image/png' };
    await provider.sendSegmentedMessage({
      segments: [
        { id: 'u', role: 'user', stable: false, content: 'x', images: Array(6).fill(img) },
      ],
    });
    const body = calls.find((c, i) => i > 0 && c.method === 'POST')?.body as {
      prompt: { images: unknown[] };
    };
    assert.equal(body.prompt.images.length, 5);
  });

  it('checkConnection: empty model is fine, a display name gets the id hint, unknown fails', async () => {
    const calls = mockFetch({
      [`GET ${api}/v1/models`]: () =>
        json({ items: [{ id: 'grok-4.6', displayName: 'Grok 4.6' }] }),
    });
    const check = (model: string) =>
      new CursorProvider(config('cursor', api, model)).checkConnection();
    assert.equal(await check(''), null);
    assert.equal(calls.length, 0);
    assert.equal(await check('grok-4.6'), null);
    assert.match(String(await check('grok 4.6')), /Use the model id "grok-4.6"/);
    assert.match(String(await check('gpt-nope')), /does not list model "gpt-nope"/);
  });

  it('test-connection passes with no model (Cursor picks its default)', async () => {
    mockFetch({
      [`GET ${api}/v1/me`]: () => json({ apiKeyName: 'k' }),
      [`GET ${api}/v1/models`]: () => json({ items: [] }),
    });
    const res = await llmService.testConnection(config('cursor', api, ''));
    assert.equal(res.success, true, res.error);
  });

  it('maps a network failure on send to a network error', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await assert.rejects(createProvider(config('cursor', api)).sendSegmentedMessage(prompt), {
      code: 'network',
      message: /fetch failed/,
    });
  });

  it('skips /v1/models items without a string id', async () => {
    mockFetch({
      [`GET ${api}/v1/models`]: () =>
        json({ items: [{ displayName: 'x' }, { id: 7 }, { id: 'ok' }] }),
    });
    assert.deepEqual(
      (await new CursorProvider(config('cursor', api)).discoverModels()).map((m) => m.id),
      ['ok']
    );
    mockFetch({ [`GET ${api}/v1/models`]: () => json({ items: 'nope' }) });
    assert.deepEqual(await new CursorProvider(config('cursor', api)).discoverModels(), []);
  });

  it('validateConfig returns false on a network error', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    assert.equal(await new CursorProvider(config('cursor', api)).validateConfig(), false);
  });
});
