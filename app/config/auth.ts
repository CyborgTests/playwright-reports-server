import crypto from 'crypto';

const tokenName = 'auth';

export function hashToken(token?: string) {
  return token ? crypto.createHash('sha256').update(token).digest('hex') : null;
}

const hoursToMilliseconds = (hours: number) => hours * 60 * 60 * 1000;

export function setTokenWithExpiry(token: string, expirationHours: number) {
  const now = new Date();

  const item = {
    value: hashToken(token),
    expiry: now.getTime() + hoursToMilliseconds(expirationHours),
  };

  localStorage.setItem(tokenName, JSON.stringify(item));
}

export function getExistingToken(expirationHours: number) {
  const item = localStorage.getItem(tokenName);

  if (!item) {
    return null;
  }

  try {
    const token = JSON.parse(item);
    const now = Date.now();

    const isExpired = now > token.expiry;
    const tooMuchTimeRemaining = token.expiry > now + hoursToMilliseconds(expirationHours);

    if (isExpired || tooMuchTimeRemaining) {
      localStorage.removeItem(tokenName);

      return null;
    }

    return token.value;
  } catch (e) {
    console.error(e);

    return null;
  }
}
