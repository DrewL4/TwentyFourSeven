const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { lookupSession, roomsFor } = require('./socket-auth');

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const httpServer = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  // Initialize Socket.io
  const { Server } = require('socket.io');
  const io = new Server(httpServer, {
    path: '/api/socket.io',
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || process.env.CORS_ORIGIN || '*',
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling']
  });

  // Store io instance globally so webhook handlers can access it
  global.io = io;

  io.on('connection', (socket) => {
    console.log('[Socket] Client connected:', socket.id);

    socket.on('disconnect', () => {
      console.log('[Socket] Client disconnected:', socket.id);
    });

    // User updates: admins get every account's changes; any other signed-in
    // user only their own (so a disabled account is signed out live). No
    // valid sign-in, no updates.
    socket.on('subscribe:users', async () => {
      const session = await lookupSession(socket.handshake.headers.cookie, { port });
      const rooms = roomsFor(session);
      if (!rooms.length) {
        console.warn('[Socket] subscribe:users refused (not signed in):', socket.id);
        socket.emit('subscribe:refused', { room: 'users', reason: 'sign-in required' });
        return;
      }
      socket.join(rooms);
      socket.emit('subscribe:ok', { scope: rooms.includes('users') ? 'all' : 'self' });
      console.log(`[Socket] Client subscribed to ${rooms.includes('users') ? 'all user updates (admin)' : 'own account updates'}:`, socket.id);
    });
  });

  httpServer
    .once('error', (err) => {
      console.error(err);
      process.exit(1);
    })
    .listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      console.log(`> Socket.io ready on ws://${hostname}:${port}/api/socket.io`);
    });
});

