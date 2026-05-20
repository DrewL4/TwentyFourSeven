import type { NextConfig } from "next";

const isProdExport = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  output: isProdExport ? "export" : undefined,
  trailingSlash: isProdExport,
  images: {
    unoptimized: isProdExport,
    // Enable remote patterns for Plex servers and common image CDNs
    remotePatterns: [
      {
        protocol: "http",
        hostname: "**",
      },
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "https",
        hostname: "*.plex.direct",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "*.plex.direct",
        port: "32400",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "*.plex.direct",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "*.plex.direct",
        port: "32400",
        pathname: "/**",
      },
      {
        protocol: "http",
        hostname: "192.168.*.*",
        port: "32400",
        pathname: "/**",
      },
    ],
    formats: ["image/webp", "image/avif"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy:
      "default-src 'self'; script-src 'none'; sandbox;",
  },
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
};

export default nextConfig;
