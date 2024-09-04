import crypto from 'crypto';

import { env } from '@/app/config/env';

const tokenName = 'auth';

export function hashToken(token?: string) {
  return token ? crypto.createHash('sha256').update(token).digest('hex') : null;
}

const getTokenExpirationHours = () => {
  return parseInt(env.UI_AUTH_EXPIRE_HOURS ?? '12', 10);
};

const hoursToMilliseconds = (hours: number) => hours * 60 * 60 * 1000;

export function setTokenWithExpiry(token: string) {
  const now = new Date();

  const expiryInHours = getTokenExpirationHours();

  const item = {
    value: hashToken(token),
    expiry: now.getTime() + hoursToMilliseconds(expiryInHours),
  };

  localStorage.setItem(tokenName, JSON.stringify(item));
}

export function getExistingToken() {
  const item = localStorage.getItem(tokenName);

  if (!item) {
    return null;
  }

  try {
    const token = JSON.parse(item);
    const now = Date.now();

    const isExpired = now > token.expiry;
    const tooMuchTimeRemaining = token.expiry > now + hoursToMilliseconds(getTokenExpirationHours());

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
