import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // Only use rewrites in development - in production, nginx handles routing
    if (process.env.NODE_ENV === 'production') {
      return [];
    }
    
    const serverPort = process.env.SERVER_PORT || '3000';
    return [
      {
        source: '/api/:path*',
        destination: `http://localhost:${serverPort}/api/:path*`,
      },
    ];
  },
  images: {
    // Enable remote patterns for Plex servers and common image CDNs
    remotePatterns: [
      // Standard HTTP/HTTPS domains
      {
        protocol: 'http',
        hostname: '**',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
      // Specific patterns for Plex Direct URLs
      {
        protocol: 'https',
        hostname: '*.plex.direct',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.plex.direct',
        port: '32400',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '*.plex.direct',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'http',
        hostname: '*.plex.direct',
        port: '32400',
        pathname: '/**',
      },
      // Local network patterns
      {
        protocol: 'http',
        hostname: '192.168.*.*',
        port: '32400',
        pathname: '/**',
      }
    ],
    // Enable image optimization
    formats: ['image/webp', 'image/avif'],
    // Add device sizes for responsive images
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    // Add image sizes for different layouts
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    // Allow unoptimized images as fallback for problematic URLs
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
