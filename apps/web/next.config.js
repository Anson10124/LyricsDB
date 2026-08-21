import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
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
