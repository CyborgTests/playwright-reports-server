import type { APIRequestContext } from '@playwright/test';

export class JsonRequest {
  constructor(private request: APIRequestContext) {}

  async send<T>(
    urlOrRequest: Parameters<APIRequestContext['fetch']>[0],
    options?: Parameters<APIRequestContext['fetch']>[1]
  ) {
    const response = await this.request.fetch(urlOrRequest, options);
    try {
      return { response, body: (await response.json().catch((e) => response.text())) as T };
    } catch (error) {
      console.error(`Response: ${response.status()} ${response.statusText()}`);
      throw error;
    }
  }
}
