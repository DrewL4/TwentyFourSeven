import { createAuthClient } from "better-auth/react";

// Function to get the server URL dynamically
function getServerUrl(): string {
  // Check if running in browser
  if (typeof window !== 'undefined') {
    // In production with nginx proxy, use the same origin as the web app
    const currentOrigin = window.location.origin;
    
    // If we're accessing via a non-standard port, assume it's through nginx proxy
    if (currentOrigin !== 'http://localhost:3001' && currentOrigin !== 'http://localhost:3000') {
      return currentOrigin;
    }
    
    // In development, if web app is on 3001, server is on 3000
    if (currentOrigin === 'http://localhost:3001') {
      return 'http://localhost:3000';
    }
  }
  
  // Fallback to environment variable or default
  return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
}

export const authClient = createAuthClient({
  baseURL: getServerUrl(),
  fetchOptions: {
    credentials: 'include', // Include cookies in cross-origin requests
  },
});
