// HDHomeRun clients (Plex DVR, Emby, Jellyfin, Channels) request /lineup.json at the
// device root; serve the same handler as /api/lineup.json.
export { GET } from "../api/lineup.json/route";
export const dynamic = "force-dynamic";
