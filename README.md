# TwentyFour/Seven

A modern, self-hosted IPTV server that creates virtual TV channels from your media library. Stream your Plex content as traditional TV channels with continuous programming, channel automation, and seamless playback.

## Features

- **Virtual TV Channels** - Create custom channels from your Plex media
- **Continuous Programming** - Channels never end with automatic schedule maintenance
- **Channel Automation** - Auto-populate channels based on genres, actors, years, and more
- **Live Streaming** - Stream channels via M3U playlists compatible with any IPTV client
- **XMLTV Guide** - Full electronic program guide (EPG) support
- **Smart Scheduling** - Respect episode order, shuffle options, and block programming
- **Hardware Transcoding** - Support for NVIDIA, Intel QuickSync, VAAPI, and more
- **Multi-User Support** - Integration with WatchTower for user management
- **Beautiful UI** - Modern, responsive interface built with Next.js and Tailwind CSS
- **API-First** - Full API access with oRPC for custom integrations

## Key Benefits

- **Never-Ending Channels** - Automatic programming maintenance ensures your channels always have content scheduled for the configured guide days
- **Set It and Forget It** - Once configured, channels run continuously without manual intervention
- **Smart Content Rotation** - Content loops seamlessly when reaching the end of your library
- **Automated Content Discovery** - Channels can automatically add new content based on your filter criteria

## Getting Started

First, install the dependencies:

```bash
npm install
```

### Environment Configuration

Configure your environment variables for both applications:

```bash
npm run setup
```

This will create `.env` files in both `apps/server/` and `apps/web/` directories.

To verify your configuration is correct, run:

```bash
npm run check-env
```

#### Port Configuration

By default:
- **Server** runs on port `3000`
- **Web** runs on port `3001`

You can customize these ports by editing the `.env` files:

**apps/server/.env:**
```env
PORT=3000
CORS_ORIGIN=http://localhost:3001
BETTER_AUTH_SECRET=your-secret-key-change-this-in-production
BETTER_AUTH_URL=http://localhost:3000
DATABASE_URL=file:./dev.db
```

**apps/web/.env:**
```env  
PORT=3001
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

> **Important:** If you change the server port, make sure to update `NEXT_PUBLIC_SERVER_URL` in the web `.env` and `BETTER_AUTH_URL` in the server `.env`. If you change the web port, update `CORS_ORIGIN` in the server `.env`.
## Database Setup

This project uses SQLite with Prisma.

1. Start the local SQLite database:
```bash
cd apps/server && npm run db:local
```

2. Update your `.env` file in the `apps/server` directory with the appropriate connection details if needed.

3. Generate the Prisma client and push the schema:
```bash
npm run db:push
```


Then, run the development server:

```bash
npm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.

The API is running at [http://localhost:3000](http://localhost:3000).



## Project Structure

```
my-app/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   └── server/      # Backend API (Next, ORPC)
```

## Available Scripts

- `npm run dev`: Start all applications in development mode
- `npm run build`: Build all applications
- `npm run setup`: Create initial .env files from examples
- `npm run check-env`: Validate environment configuration
- `npm run dev:web`: Start only the web application
- `npm run dev:server`: Start only the server  
- `npm run check-types`: Check TypeScript types across all apps
- `npm run db:push`: Push schema changes to database
- `npm run db:studio`: Open database studio UI
