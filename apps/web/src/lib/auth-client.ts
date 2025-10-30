import { createAuthClient } from "better-auth/react";

// Function to get the server URL dynamically
function getServerUrl(): string {
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
      // Use NEXT_PUBLIC_SERVER_URL if set (for Docker/production), otherwise fallback to localhost:3000
      return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
    }

    // For all other domains (including your 247.midweststreams.us), use the same origin
    return currentOrigin;
  }

  // Server-side fallback - prioritize NEXT_PUBLIC_SERVER_URL for Docker environments
  return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
}

export const authClient = createAuthClient({
  baseURL: getServerUrl(),
  fetchOptions: {
    credentials: 'include', // Include cookies in cross-origin requests
  },
});
