// Socket.io server is initialized in server.js
// This file provides helper functions to emit events

declare global {
  var io: any;
}

export function emitUserUpdate(userEmail: string, action: 'created' | 'updated' | 'deleted') {
  // Access the global io instance set by server.js
  if (typeof global !== 'undefined' && global.io) {
    console.log(`[Socket] Emitting user.${action} event for ${userEmail}`);
    global.io.to('users').emit('user:update', {
      email: userEmail,
      action,
      timestamp: new Date().toISOString()
    });
  } else {
    console.warn('[Socket] Cannot emit event - Socket.io server not initialized');
  }
}

export function emitUsersRefresh() {
  if (typeof global !== 'undefined' && global.io) {
    global.io.to('users').emit('users:refresh', {
      timestamp: new Date().toISOString(),
    });
  }
}

