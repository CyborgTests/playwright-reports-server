import NextAuth from 'next-auth';
import { NextAuthConfig } from 'next-auth';
import { type User } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import jwt from 'jsonwebtoken';

import { env } from './config/env';

const useAuth = !!env.API_TOKEN;
const useGoogleAuth = useAuth && env.AUTH_GOOGLE_ENABLED;

// strictly recommended to specify via env var
// Use a stable default secret when AUTH_SECRET is not set to avoid JWT decryption errors
// This is only acceptable when auth is disabled (no API_TOKEN)
const secret = env.AUTH_SECRET ?? 'default-secret-for-non-auth-mode';

// session expiration for api token auth
const expirationHours = env.UI_AUTH_EXPIRE_HOURS ? parseInt(env.UI_AUTH_EXPIRE_HOURS) : 2;
const expirationSeconds = expirationHours * 60 * 60;

const allowedDomains = (env.AUTH_ALLOWED_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

const isEmailDomainAllowed = (email: string | null | undefined): boolean => {
  if (!email || allowedDomains.length === 0) return false;
  const domain = email.split('@')[1]?.toLowerCase();

  return !!domain && allowedDomains.includes(domain);
};

export const authConfig: NextAuthConfig = {
  secret,
  providers: [
    CredentialsProvider({
      name: 'API Token',
      credentials: {
        apiToken: { label: 'API Token', type: 'password' },
      },
      async authorize(credentials): Promise<User | null> {
        if (credentials?.apiToken === env.API_TOKEN) {
          const token = jwt.sign({ authorized: true }, secret);

          return {
            apiToken: credentials.apiToken as string,
            jwtToken: token,
          };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.apiToken = user.apiToken;
        token.jwtToken = user.jwtToken;
      }

      return token;
    },
    async session({ session, token }) {
      session.user.apiToken = token.apiToken as string;
      session.user.jwtToken = token.jwtToken as string;

      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: expirationSeconds,
  },
  trustHost: true,
  pages: {
    signIn: '/login',
  },
};

const googleConfig = {
  secret,
  providers: [
    GoogleProvider({
      clientId: env.AUTH_GOOGLE_CLIENT_ID,
      clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.email_verified) return false;

      return isEmailDomainAllowed(profile.email);
    },
    async jwt({ token, user, profile }) {
      // on first sign-in copy the verified profile fields onto the JWT,
      // and stash the server-side API_TOKEN so UI fetches to /api/* keep working.
      if (user) {
        const email = profile?.email ?? user.email ?? token.email;
        const name = profile?.name ?? user.name ?? token.name;
        const picture = profile?.picture ?? user.image ?? token.picture;

        token.name = name;
        token.email = email;
        token.picture = picture;
        token.apiToken = env.API_TOKEN;
        token.jwtToken = jwt.sign({ authorized: true, email }, secret);
      }

      return token;
    },
    async session({ session, token }) {
      session.user.name = token.name as string;
      session.user.email = token.email as string;
      session.user.image = token.picture as string;
      session.user.apiToken = token.apiToken as string;
      session.user.jwtToken = token.jwtToken as string;

      return session;
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: expirationSeconds,
  },
  trustHost: true,
  pages: {
    signIn: '/login',
  },
} satisfies NextAuthConfig;

const getJwtStubToken = () => {
  return jwt.sign({ authorized: true }, secret);
};

const noAuth = {
  providers: [
    CredentialsProvider({
      name: 'No Auth',
      credentials: {},
      async authorize() {
        const token = getJwtStubToken();

        return { apiToken: token, jwtToken: token };
      },
    }),
  ],
  callbacks: {
    authorized: async () => {
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.apiToken = user.apiToken;
        token.jwtToken = user.jwtToken;
      }

      return token;
    },
    async session({ session, token }) {
      session.sessionToken = getJwtStubToken();
      session.user.jwtToken = session.sessionToken;
      session.user.apiToken = token.apiToken as string;

      return session;
    },
  },
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: expirationSeconds,
  },
  secret,
} satisfies NextAuthConfig;

const selectedConfig: NextAuthConfig = !useAuth ? noAuth : useGoogleAuth ? googleConfig : authConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(selectedConfig);
