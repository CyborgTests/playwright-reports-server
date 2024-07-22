export class CommonResponseFactory {
  static buildUnauthorizedResponse(): Response {
    return new Response('Unauthorized', { status: 401 });
  }
}
