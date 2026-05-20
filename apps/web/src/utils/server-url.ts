/**
 * Get the server URL dynamically based on the current environment
 * This handles both development and production scenarios correctly
 */
export function getServerUrl(): string {
  // In the browser, always use the page origin so auth cookies stay same-site.
  // Dev Next.js rewrites /api (and /rpc) to the backend; prod nginx proxies the same paths.
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }

  return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
} 