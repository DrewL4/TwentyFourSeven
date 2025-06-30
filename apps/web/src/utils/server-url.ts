/**
 * Get the server URL dynamically based on the current environment
 * This handles both development and production scenarios correctly
 */
export function getServerUrl(): string {
  // Check if running in browser
  if (typeof window !== 'undefined') {
    // In production, always use the same origin as the web app
    const currentOrigin = window.location.origin;
    
    // Only use localhost fallback if we're actually on localhost
    if (currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1')) {
      // In development, if web app is on 3001, server is on 3000
      if (currentOrigin === 'http://localhost:3001') {
        return 'http://localhost:3000';
      }
      return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
    }
    
    // For all other domains (including external domains like 247.midweststreams.us), 
    // use the same origin since nginx routes everything through port 80
    return currentOrigin;
  }
  
  // Server-side fallback
  return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
} 