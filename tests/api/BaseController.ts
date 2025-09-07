import { APIRequestContext } from '@playwright/test';

export abstract class BaseController {
  request: APIRequestContext;

  constructor(request: APIRequestContext) {
    this.request = request;
  }
}
