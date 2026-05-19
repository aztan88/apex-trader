/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Treat yahoo-finance2 as an external — don't bundle it through webpack
  serverExternalPackages: ['yahoo-finance2'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore yahoo-finance2 test files that pull in Deno/missing deps
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('yahoo-finance2');
      }
    }
    // Suppress missing module warnings for yahoo-finance2 test deps
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      '@std/testing/mock': false,
      '@std/testing/bdd': false,
    };
    // Ignore the test file entirely
    config.plugins = config.plugins || [];
    const webpack = require('webpack');
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /yahoo-finance2\/esm\/tests/,
      })
    );
    return config;
  },
};

module.exports = nextConfig;
