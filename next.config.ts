import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/proxy/:path*', destination: '/api/proxy/:path*' },
    ];
  },
};

export default nextConfig;
