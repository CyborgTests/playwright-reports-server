import { isAuthorized } from '../../auth';

describe('isAuthorized', () => {
  it('should return true if actualAuthToken matches expectedAuthToken', () => {
    const actualAuthToken = 'abc123';
    const expectedAuthToken = 'abc123';
    const result = isAuthorized({ actualAuthToken, expectedAuthToken });
    expect(result).toBe(true);
  });

  it('should return false if actualAuthToken does not match expectedAuthToken', () => {
    const actualAuthToken = 'abc123';
    const expectedAuthToken = 'def456';
    const result = isAuthorized({ actualAuthToken, expectedAuthToken });
    expect(result).toBe(false);
  });

  it('should return false if actualAuthToken is null', () => {
    const actualAuthToken = null;
    const expectedAuthToken = 'abc123';
    const result = isAuthorized({ actualAuthToken, expectedAuthToken });
    expect(result).toBe(false);
  });
});
