import { createMDX } from 'fumadocs-mdx/next';
import { COVER_IMAGE_HOSTS } from './lib/image-hosts.js';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    remotePatterns: COVER_IMAGE_HOSTS.map((hostname) => ({ hostname })),
    // Cover art URLs point at fixed files, so optimized copies can stay cached
    minimumCacheTTL: 60 * 60 * 24 * 31,
  },
  async headers() {
    // Only the web app's own route; the rest of /api is proxied and gets the
    // header from the API itself (setting it here too would duplicate it)
    return [
      {
        source: '/api/search',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
    ];
  },
  async rewrites() {
    // Determine backend API URL:
    // 1. Explicit internal service URL (e.g. http://api:4000 in Docker)
    // 2. Explicit public API URL if provided
    // 3. Defaults to http://api:4000 in production container or http://localhost:4000 in dev
    const apiUrl =
      process.env.API_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      (process.env.NODE_ENV === 'production' ? 'http://api:4000' : 'http://localhost:4000');

    return [
      {
        source: '/api/:path*',
        destination: `${apiUrl.replace(/\/$/, '')}/api/:path*`,
      },
    ];
  },
};

export default withMDX(nextConfig);
