import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Instrumentation is enabled by default in Next.js 13.2+
  async headers() {
    // In production, CORS is handled by nginx and the backend API
    // Only set CORS headers in development
    if (process.env.NODE_ENV === 'production') {
      return [];
    }

    return [
      {
        // Apply CORS headers to all API routes (development only)
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: 'http://localhost:3001' },
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization, Cookie' },
        ],
      },
    ];
  },
};

export default nextConfig;
