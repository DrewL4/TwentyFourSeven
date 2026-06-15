"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { queryClient } from "@/utils/orpc";
import { ThemeProvider } from "./theme-provider";
import { Toaster } from "./ui/sonner";
import UserUpdatesProvider from "./user-updates-provider";
import { SocketProvider } from "@/contexts/socket-context";


export default function Providers({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <QueryClientProvider client={queryClient}>
        <SocketProvider>
          <UserUpdatesProvider>
            {children}
          </UserUpdatesProvider>
        </SocketProvider>
        <ReactQueryDevtools 
          initialIsOpen={false}
          position="bottom"
          buttonPosition="bottom-right"
        />
      </QueryClientProvider>
      <Toaster richColors />
    </ThemeProvider>
  );
}
