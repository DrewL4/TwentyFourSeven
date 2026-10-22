// HDHomeRun clients (Plex DVR, Emby, Jellyfin, Channels) request /lineup_status.json at the
// device root; serve the same handler as /api/lineup_status.json.
export { GET } from "../api/lineup_status.json/route";
export const dynamic = "force-dynamic";
