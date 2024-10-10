import NextAuth from 'next-auth';
import { NextAuthConfig } from 'next-auth';
import { type User } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import jwt from 'jsonwebtoken';

const useAuth = !!process.env.API_TOKEN;

// strictly recommended to specify via env var
const secret = process.env.AUTH_SECRET ?? crypto.randomUUID();

export const authConfig: NextAuthConfig = {
  secret,
  providers: [
    CredentialsProvider({
      name: 'API Token',
      credentials: {
        apiToken: { label: 'API Token', type: 'password' },
      },
      async authorize(credentials): Promise<User | null> {
        if (credentials?.apiToken === process.env.API_TOKEN) {
          const expiration = process.env.UI_AUTH_EXPIRE_HOURS ? parseInt(process.env.UI_AUTH_EXPIRE_HOURS) : 2;

          const token = jwt.sign({ authorized: true }, secret, {
            expiresIn: `${expiration}h`,
          });

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
  trustHost: true,
  pages: {
    signIn: '/login',
  },
};

const getJwtStubToken = () => {
  return jwt.sign({ authorized: true }, secret, {
    expiresIn: '2h',
  });
};

const noAuth = {
  providers: [
    CredentialsProvider({
      name: 'No Auth',
      credentials: {},
      async authorize() {
        const token = getJwtStubToken();

        return { apiToken: token };
      },
    }),
  ],
  callbacks: {
    authorized: async () => {
      return true;
    },
    async session({ session }) {
      session.sessionToken = getJwtStubToken();
      session.user.jwtToken = session.sessionToken;

      return session;
    },
  },
  trustHost: true,
  secret,
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(useAuth ? authConfig : noAuth);
