import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { appRouter } from "../../../server/src/routers/index";
import type { RouterClient } from "@orpc/server";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 2 minutes (reduced for better responsiveness)
      staleTime: 2 * 60 * 1000,
      // Data is cached for 10 minutes
      gcTime: 10 * 60 * 1000,
      // Don't refetch on window focus to prevent unnecessary updates
      refetchOnWindowFocus: false,
      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
    mutations: {
      // Retry failed mutations once
      retry: 1,
      retryDelay: 1000,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      toast.error(`Error: ${error.message}`, {
        action: {
          label: "retry",
          onClick: () => {
            queryClient.invalidateQueries();
          },
        },
      });
    },
  }),
});

// Function to get the server URL dynamically
function getServerUrl(): string {
  // Check if running in browser
  if (typeof window !== 'undefined') {
    // In production, always use the same origin as the web app
    const currentOrigin = window.location.origin;
    
    // Only use localhost fallback if we're actually on localhost
    if (currentOrigin.includes('localhost') || currentOrigin.includes('127.0.0.1')) {
      return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
    }
    
    // For all other domains (including your 247.midweststreams.us), use the same origin
    return currentOrigin;
  }
  
  // Server-side fallback
  return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000';
}

export const link = new RPCLink({
  url: `${getServerUrl()}/rpc`,
  fetch(url, options) {
    return fetch(url, {
      ...options,
      credentials: "include",
    });
  },
});

export const client: RouterClient<typeof appRouter> = createORPCClient(link)

export const orpc = createTanstackQueryUtils(client)
