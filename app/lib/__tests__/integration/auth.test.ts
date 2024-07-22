import { env } from '@/app/config/env';
import { randomUUID } from 'crypto';

describe('Auth component', () => {
  const fetchListOfReports = async (authToken: string) => {
    const url = 'http://localhost:3000/api/report/list';
    const response = await fetch(url, {
      headers: {
        Authorization: authToken,
      },
    });
    return response;
  };

  it('should return success response if the Autorization header is right', async () => {
    const response = await fetchListOfReports(env.API_TOKEN);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toBe('Unauthorized');
  });

  it('should return unauthorised if the Autorization header is wrong', async () => {
    const response = await fetchListOfReports(randomUUID());
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('Unauthorized');
  });
});
