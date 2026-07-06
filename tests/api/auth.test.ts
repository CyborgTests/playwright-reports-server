import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { test } from './fixtures/base';
//  TO DO: investigate how run test with auth and without it

// test ('should return success response if the Autorization header is right', async ({request}) => {
//    const token = process.env.API_TOKEN;
//    const response = await request.get('/api/result/list', {
//     headers: {
//       Authorization: `${token}`,
//     },
//   });
//   expect(response.status()).toBe(200);
//   expect(await response.text()).not.toBe('Unauthorized');
// });

// test ('should return unauthorised if the Autorization header is wrong', async ({request}) => {
//    const response = await request.get('/api/report/list', {
//     headers: {
//       Authorization: `Bearer ${randomUUID()}`,
//     },
//   });
//   expect(response.status()).toBe(401);
//   expect(await response.text()).toBe('Unauthorized');
// });
