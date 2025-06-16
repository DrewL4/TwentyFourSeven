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
    // In production with nginx proxy, use the same origin as the web app
    const currentOrigin = window.location.origin;
    
    // If we're accessing via a non-standard port, assume it's through nginx proxy
    if (currentOrigin !== 'http://localhost:3001' && currentOrigin !== 'http://localhost:3000') {
      return currentOrigin;
    }
  }
  
  // Fallback to environment variable or default
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
