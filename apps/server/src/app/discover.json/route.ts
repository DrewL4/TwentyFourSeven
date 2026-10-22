// HDHomeRun clients (Plex DVR, Emby, Jellyfin, Channels) request /discover.json at the
// device root; serve the same handler as /api/discover.json.
export { GET } from "../api/discover.json/route";
export const dynamic = "force-dynamic";
