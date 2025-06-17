/** @type {import('next').NextConfig} */
const nextConfig = {
  // Experimental features for better Docker builds
  experimental: {
    // Reduce memory usage during builds
    workerThreads: false,
    cpus: 1,
  },
  
  // Output configuration
  output: 'standalone',
};

module.exports = nextConfig; 