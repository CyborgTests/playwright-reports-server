const API_BASE_PATH = process.env.API_BASE_PATH || '';
const ASSETS_BASE_PATH = process.env.ASSETS_BASE_PATH || ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
  },
  // basePath: API_BASE_PATH,
  assetPrefix: ASSETS_BASE_PATH,
  env: {
    API_BASE_PATH,
  },
};

module.exports = nextConfig;
