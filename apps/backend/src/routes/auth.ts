import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const apiTokenMatches = (candidate: string | undefined): boolean => {
  const expected = env.API_TOKEN;
  if (!expected || !candidate) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // timingSafeEqual requires same length; pad the shorter side and flag.
  const len = Math.max(a.length, b.length);
  const ap = Buffer.alloc(len);
  const bp = Buffer.alloc(len);
  a.copy(ap);
  b.copy(bp);
  const equalBytes = timingSafeEqual(ap, bp);
  return equalBytes && a.length === b.length;
};

const useAuth = !!env.API_TOKEN;

// strictly recommended to specify via env var
// Use a stable default secret when AUTH_SECRET is not set to avoid JWT decryption errors
// This is only acceptable when auth is disabled (no API_TOKEN)
const secret = env.AUTH_SECRET ?? 'default-secret-for-non-auth-mode';

const expirationHours = env.UI_AUTH_EXPIRE_HOURS
  ? Number.parseInt(env.UI_AUTH_EXPIRE_HOURS, 10)
  : 2;
const expirationSeconds = expirationHours * 60 * 60;

interface JWTPayload {
  authorized: boolean;
  apiToken: string;
}

interface AuthUser {
  apiToken: string;
  jwtToken: string;
}

interface AuthRequest extends Omit<FastifyRequest, 'user'> {
  user?: AuthUser;
}

const createAuthTokens = (apiToken: string): AuthUser => {
  const payload: JWTPayload = { authorized: true, apiToken };
  const jwtToken = jwt.sign(payload, secret, { expiresIn: `${expirationHours}h` });
  return { apiToken, jwtToken };
};

const createNoAuthTokens = (): AuthUser => {
  const payload: JWTPayload = { authorized: true, apiToken: '' };
  const token = jwt.sign(payload, secret, { expiresIn: `${expirationHours}h` });
  return { apiToken: '', jwtToken: token };
};

const verifyToken = (token: string): JWTPayload | null => {
  try {
    return jwt.verify(token, secret) as JWTPayload;
  } catch (_error) {
    return null;
  }
};

export const isAuthenticated = async (request: AuthRequest): Promise<boolean> => {
  if (!useAuth) return true;

  const authHeader = request.headers.authorization;
  const cookieToken = request.cookies?.token;

  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) return false;
  return verifyToken(token) !== null;
};

export const authenticateUpload = async (request: AuthRequest, reply: FastifyReply) => {
  if (!useAuth) {
    request.user = createNoAuthTokens();
    return;
  }

  const authHeader = request.headers.authorization;
  const cookieToken = request.cookies.token;

  // Allow reporter to authenticate upload calls
  // with the raw API_TOKEN - either plain or with a Bearer prefix.
  if (authHeader) {
    const candidate = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    if (apiTokenMatches(candidate)) {
      request.user = createAuthTokens(env.API_TOKEN as string);
      return;
    }
  }

  let token: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized: No token provided' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or expired token' });
  }

  request.user = { apiToken: decoded.apiToken, jwtToken: token };
};

export const authenticate = async (request: AuthRequest, reply: FastifyReply) => {
  if (!useAuth) {
    request.user = createNoAuthTokens();
    return;
  }

  const authHeader = request.headers.authorization;
  const cookieToken = request.cookies.token;

  let token = null;

  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (cookieToken) {
    token = cookieToken;
  }

  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized: No token provided' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return reply.status(401).send({ error: 'Unauthorized: Invalid or expired token' });
  }

  request.user = {
    apiToken: decoded.apiToken,
    jwtToken: token,
  };
};

export const getSession = async (request: AuthRequest, reply: FastifyReply) => {
  if (!useAuth) {
    const noAuthUser = createNoAuthTokens();
    return {
      user: {
        apiToken: noAuthUser.apiToken,
        jwtToken: noAuthUser.jwtToken,
      },
      expires: new Date(Date.now() + expirationSeconds * 1000).toISOString(),
    };
  }

  try {
    await authenticate(request, reply);

    if (request.user) {
      return {
        user: {
          apiToken: request.user.apiToken,
          jwtToken: request.user.jwtToken,
        },
        expires: new Date(Date.now() + expirationSeconds * 1000).toISOString(),
      };
    }
  } catch (_error) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
};

export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.post('/api/auth/signin', async (request, reply) => {
    try {
      const { apiToken } = request.body as { apiToken?: string };

      if (!useAuth) {
        const noAuthUser = createNoAuthTokens();

        // Set token in cookie
        reply.setCookie('token', noAuthUser.jwtToken, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: expirationSeconds,
        });

        return {
          user: {
            apiToken: noAuthUser.apiToken,
            jwtToken: noAuthUser.jwtToken,
          },
          success: true,
        };
      }

      if (!apiToken || !apiTokenMatches(apiToken)) {
        return reply.status(401).send({
          error: 'Invalid API token',
          success: false,
        });
      }

      const authUser = createAuthTokens(apiToken);

      reply.setCookie('token', authUser.jwtToken, {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: expirationSeconds,
      });

      return {
        user: {
          apiToken: authUser.apiToken,
          jwtToken: authUser.jwtToken,
        },
        success: true,
      };
    } catch (error) {
      fastify.log.error({ error }, 'Sign in error');
      return reply.status(500).send({
        error: 'Internal server error',
        success: false,
      });
    }
  });

  fastify.post('/api/auth/signout', (_, reply) => {
    try {
      reply.clearCookie('token', { path: '/' });

      return {
        success: true,
        message: 'Signed out successfully',
      };
    } catch (error) {
      fastify.log.error({ error }, 'Sign out error');
      return reply.status(500).send({
        error: 'Internal server error',
        success: false,
      });
    }
  });

  fastify.get('/api/auth/session', async (request, reply) => {
    try {
      const sessionData = await getSession(request as AuthRequest, reply);
      return sessionData;
    } catch (_error) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.all('/api/auth/*', async (request, reply) => {
    // Handle various next-auth endpoints for compatibility
    const path = (request.params as { '*': string })['*'] || '';

    switch (path) {
      case 'signin':
        return reply.send({
          providers: [
            {
              id: 'credentials',
              name: 'API Token',
              type: 'credentials',
            },
          ],
        });

      case 'session':
        return await getSession(request as AuthRequest, reply);

      default:
        return reply.status(404).send({ error: 'Not found' });
    }
  });
}

export type { AuthRequest, AuthUser };
export { useAuth, secret, expirationSeconds };
