# TwentyFour/Seven (TFS)

TwentyFour/Seven turns your movie and TV folders (or your Plex library) into always-on TV channels, with a program guide, that any IPTV app can play. It is a sister app of **WatchTower**. Everyone signs in with their WatchTower account.

**Install WatchTower first.** TFS sign-in only works through WatchTower, so set WatchTower up and create your WatchTower admin account before this. See the WatchTower README.

Setup order:
1. WatchTower
2. WatchTower Guide
3. TwentyFourSeven (this page)

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

---

## Install on Unraid

### Step 1: Add the container

Go to **Docker → Add Container** and pick the **TwentyFourSeven** template (`twentyfourseven-unraid-template.xml` in this repo), or enter the repository `drew4/twentyfourseven:latest`. Then fill in:

| Field | What to enter |
|---|---|
| **HTTP Port** | `8088`, or any free port. You open TFS at `http://YOUR-UNRAID-IP:PORT` |
| **Server URL** | The address you open TFS with, for example `http://192.168.1.50:8088` or `https://tv.example.com` |
| **Trusted Origins** | Every address you open TFS with, separated by commas. For example: `http://localhost:8088,http://192.168.1.50:8088,https://tv.example.com`. If your address is missing, sign-in fails. |
| **Database Storage** | `/mnt/user/appdata/twentyfourseven/database`. **Don't leave it empty.** It holds your channels and settings, and the sign-in key. |
| **Static Files Storage** | `/mnt/user/appdata/twentyfourseven/static`. Files placed here can be opened at `http://YOUR-UNRAID-IP:PORT/files/`. |
| **Authentication Secret** | Leave empty. TFS makes one on first start and saves it in the Database Storage folder, so restarts and updates don't sign anyone out. |
| **Media** | Leave it at `/mnt/user`. TFS can then look through your shares (read-only, it can't change anything) and you pick the movie and TV folders in Settings later. To let it see less, use your media share instead, for example `/mnt/user/Media`. |
| **Movies Folder / TV Shows Folder** | Optional. Leave empty when **Media** already covers them. |
| **Timezone** | For example `America/Chicago` (under **Show more settings**) |

**Using your own domain** (for example through Nginx Proxy Manager)? At the bottom of the template, use **Add another Path, Port, Variable, Label or Device** to add the variables `EXTERNAL_DOMAIN` (for example `tv.example.com`) and `EXTERNAL_PROTOCOL` (`https`). TFS then builds its own addresses from them.

**Graphics card (optional):** TFS works without one. For faster video with an NVIDIA card, you need the Unraid NVIDIA-Driver plugin. Then add `--runtime=nvidia` to **Extra Parameters** (under **Show more settings**). Leave **NVIDIA Visible Devices** at `all`. For Intel or AMD, set **Hardware Acceleration Device** to `/dev/dri/renderD128` and add the `/dev/dri` device.

If you see "permission denied" errors for the database or static folder, run this once in the Unraid terminal:
`chown -R 1001:100 /mnt/user/appdata/twentyfourseven`

Click **Apply**.

### Step 2: Connect TFS to WatchTower

1. In **WatchTower**, go to **Admin → Connections → WatchTower Guide & TFS Connect**. If the TwentyFourSeven card has no token yet, click **Create App Tokens**.
2. On the **TwentyFourSeven** card, type TFS's address (the Server URL from Step 1) and click **Connect**. WatchTower sends TFS its address and token.
3. If TFS still shows **First-time server setup** on its **Sign in with WatchTower** page, fill it in by hand:
   - **WatchTower server URL**: your WatchTower address, for example `https://watchtower.example.com`
   - **Integration API token**: the TwentyFourSeven token from that WatchTower page

### Step 3: Sign in

On the same page, sign in with your WatchTower email and password.

### Step 4: Choose where your videos come from

Open **Settings**. The first card asks **Where should TwentyFourSeven get your videos?**

- **Local files (recommended)**: TFS plays files straight from your folders. It's the fastest choice and nothing else has to be running.
  - Press **Find my videos**. TFS looks a few folders deep, shows the folders that look like movies or TV shows with how many videos each has, and you press **Use these folders**.
  - Or press **Browse** to open folders yourself. Each folder shows its video count and a *Looks like Movies* / *Looks like TV shows* hint. Tick the ones you want and press **Save folders**.
  - Unraid system shares (`appdata`, `system`, `domains`, `isos`) and hidden folders are never shown.
  - If TFS says it **can't see your video folders yet**, the container has no media path. The card shows the Unraid steps: **Docker** tab → **TwentyFourSeven** → **Edit** → **Add another Path, Port, Variable, Label or Device** → Container Path `/media`, Host Path `/mnt/user/Media` (or `/mnt/user`), Access Mode **Read Only** → **Add** → **Apply**.
  - The status line then tells you what it found, for example *Found 1,234 movies and 456 shows*, or what to fix.
- **Plex**: connect Plex under **Settings → Plex** first, then pick Plex.

You can switch any time. Channels keep their shows and movies: TFS finds the same title in the other source. Anything it can't find is listed and keeps playing from the old source.

**Folder layout that works best:** `TV/Show Name/Season 01/Show Name - S01E01.mkv` and `Movies/Movie Name (2010)/Movie Name (2010).mkv`. `.nfo` files and `poster.jpg`/`folder.jpg` next to the videos are used for titles, summaries and posters. New files are picked up automatically, and only changed files are re-read.

**Why not read ESPG's database?** TFS reads the same folders ESPG does, but keeps its own small index. That way TFS works without ESPG, an ESPG update can't break TFS, and TFS never needs write access to your media.

### Step 5: Links for TV apps

Under **Settings → Links for TV apps**, add each TV app or DVR (TiviMate, Plex DVR, Channels…) by name and copy its playlist (M3U), guide (XMLTV) or HDHomeRun address. Each device gets its own link; **Turn off** stops just that device. Links never contain file paths or Plex passwords. Devices on your home network can still use the plain `/media.m3u` address unless you turn that off.

---

## Good to know

- **Updates:** updating the container is enough. Your channels and the sign-in key are kept in the Database Storage folder.
- **Playback:** files that TV apps can already play are sent as-is (no re-encoding), so they start fast and use almost no CPU. Others are converted on the fly, using the graphics card when there is one.
- **Reverse proxy:** if you put TFS behind Nginx Proxy Manager or similar, make sure it sends `X-Forwarded-For` (NPM does by default). Without it, outside visitors look like they're on your home network.
- **Health check:** `http://YOUR-UNRAID-IP:PORT/api/health` should answer with `"status":"ok"`.
- **Docker Hub image:** pushing to `main` builds and pushes `drew4/twentyfourseven:latest` on GitHub's own servers (`.github/workflows/docker-build.yml`).

---

## For developers

### Local development

First, install the dependencies:

```bash
npm install
```

#### Environment configuration

Configure your environment variables for both applications:

```bash
npm run setup
```

This will create `.env` files in both `apps/server/` and `apps/web/` directories.

To verify your configuration is correct, run:

```bash
npm run check-env
```

##### Port configuration

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
#### Database setup

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



#### Project structure

```
my-app/
├── apps/
│   ├── web/         # Frontend application (Next.js)
│   └── server/      # Backend API (Next, ORPC)
```

#### Available scripts

- `npm run dev`: Start all applications in development mode
- `npm run build`: Build all applications
- `npm run setup`: Create initial .env files from examples
- `npm run check-env`: Validate environment configuration
- `npm run dev:web`: Start only the web application
- `npm run dev:server`: Start only the server  
- `npm run check-types`: Check TypeScript types across all apps
- `npm run db:push`: Push schema changes to database
- `npm run db:studio`: Open database studio UI
