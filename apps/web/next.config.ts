import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @gym/db ships raw TypeScript (main: src/index.ts) — Next must transpile it.
  transpilePackages: ['@gym/db'],
};

export default nextConfig;
