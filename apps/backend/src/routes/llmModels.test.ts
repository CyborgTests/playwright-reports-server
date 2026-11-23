import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LLM_PROVIDER_TYPES } from '@playwright-reports/shared';
import { ModelBodySchema } from './llmModels.js';

describe('POST /api/config/llm-models body', () => {
  const body = { label: 'x', baseUrl: 'https://x', model: 'm' };

  for (const provider of LLM_PROVIDER_TYPES) {
    it(`accepts provider ${provider}`, () => {
      assert.equal(ModelBodySchema.safeParse({ ...body, provider }).success, true);
    });
  }

  it('rejects an unknown provider', () => {
    assert.equal(ModelBodySchema.safeParse({ ...body, provider: 'gemini' }).success, false);
  });
});
