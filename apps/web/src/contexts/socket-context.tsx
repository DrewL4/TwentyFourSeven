"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Socket } from "socket.io-client";
import { useSocket } from "@/hooks/use-socket";

interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});

export function SocketProvider({ children }: { children: ReactNode }) {
  const value = useSocket();
  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocketContext() {
  return useContext(SocketContext);
}
