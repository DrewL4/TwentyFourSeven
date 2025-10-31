import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

let io: SocketIOServer | null = null;

export function initializeSocketServer(httpServer: HTTPServer) {
  if (io) {
    return io;
  }

  io = new SocketIOServer(httpServer, {
    path: '/api/socket.io',
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log('[Socket] Client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('[Socket] Client disconnected:', socket.id);
    });

    // Join room for user updates
    socket.on('subscribe:users', () => {
      socket.join('users');
      console.log('[Socket] Client subscribed to user updates:', socket.id);
    });
  });

  return io;
}

export function getSocketServer(): SocketIOServer | null {
  return io;
}

export function emitUserUpdate(userEmail: string, action: 'created' | 'updated' | 'deleted') {
  if (!io) {
    console.warn('[Socket] Cannot emit event - Socket.io server not initialized');
    return;
  }

  console.log(`[Socket] Emitting user.${action} event for ${userEmail}`);
  io.to('users').emit('user:update', {
    email: userEmail,
    action,
    timestamp: new Date().toISOString()
  });
}

