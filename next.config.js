/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // yahoo-finance2 uses Node.js APIs — must run server-side only
  serverExternalPackages: ['yahoo-finance2'],
  // Fallback for older Next.js 14 versions
  experimental: {
    serverComponentsExternalPackages: ['yahoo-finance2'],
  },
};

module.exports = nextConfig;
