"use client";

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getServerUrl } from '@/utils/server-url';

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Use the same server URL utility as the rest of the app
    const serverUrl = getServerUrl();
    
    console.log('[Socket] Connecting to:', serverUrl);
    
    const socket = io(serverUrl, {
      path: '/api/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      setIsConnected(true);
      
      // Subscribe to user updates
      socket.emit('subscribe:users');
    });

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected');
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error);
      setIsConnected(false);
    });

    return () => {
      console.log('[Socket] Cleaning up connection');
      socket.disconnect();
    };
  }, []);

  return { socket: socketRef.current, isConnected };
}

