import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Pin Turbopack workspace root to this package — avoids false detection
  // of stray lockfiles higher up the directory tree (e.g., in $HOME).
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Next.js 16 promoted typedRoutes out of experimental.
  typedRoutes: true,
  // D-10 (Plan 01.1) -- standalone output powers `node .next/standalone/server.js`
  // as the production CMD in Dockerfile runner stage; local `pnpm start:web` matches.
  output: 'standalone',
  poweredByHeader: false,
  compress: true,
};

export default nextConfig;
