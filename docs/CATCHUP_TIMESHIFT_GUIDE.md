# Catchup / Timeshift Guide

This document covers the catchup (timeshift) functionality in TwentyFourSeven, enabling viewers to watch previously aired programs on demand through standard IPTV catchup mechanisms.

## Overview

Catchup allows viewers to rewind and watch programs that have already aired on any channel. TwentyFourSeven implements this using a **Plex-seeking approach** rather than segment recording, meaning no additional storage is required. When a viewer requests a past program, the system calculates the correct seek offset within the Plex media file and streams from that point using FFmpeg.

### How It Works

1. A program airs on a channel at a scheduled time
2. Within the configured catchup window (e.g., 24 hours), the program remains available for on-demand viewing
3. When a viewer requests a catchup stream, the system:
   - Locates the program that was airing at the requested time
   - Resolves the underlying Plex media file
   - Calculates the seek offset based on the difference between the program start time and the requested time
   - Streams the content via FFmpeg with the appropriate seek position

### Supported IPTV Players

The catchup tags follow the industry-standard `HLScatchup` specification and are compatible with:

- **TiviMate** (Android) - Full catchup support with EPG integration
- **OTT Navigator** (Android) - VOD catchup mode
- **IPTV Smarters Pro** (Android/iOS) - Catchup via archive
- **Televizo** (Android) - Timeshift support
- **Any player supporting `catchup="vod"` tags**

## Configuration

### Global Settings

Navigate to **Settings** in the web interface to configure global catchup behavior:

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Catchup Globally** | `true` | Master toggle for all catchup functionality. When disabled, no catchup metadata is included in M3U or XMLTV outputs. |
| **Default Catchup Window** | `24 hours` | Default window for new channels. Options: 6, 12, 24, or 48 hours. |

### Per-Channel Settings

Each channel can independently control its catchup behavior. Navigate to **Channels**, click the edit button on a channel, and scroll to the **Catchup / Timeshift** section:

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Catchup** | `true` | Toggle catchup for this specific channel. |
| **Catchup Window** | `24 hours` | How far back viewers can go for this channel (1-48 hours). |

### Priority Logic

Catchup is available for a program only when **all** of the following are true:

1. Global catchup is enabled in Settings
2. The channel has catchup enabled
3. The program's `catchupAvailable` flag is true (defaults to true)
4. The current time is within the program's catchup window (program end time + catchup window hours)

## Endpoints

### Main M3U Playlist (`/media.m3u`)

When catchup is enabled, the standard M3U playlist automatically includes catchup tags for eligible channels:

```
#EXTINF:-1 tvg-id="My Channel" tvg-name="My Channel" tvg-chno="1" catchup="vod" catchup-days="1" catchup-source="https://yourserver/api/video?channel=1&catchup=true&utc=${start}&lutc=${timestamp}",My Channel
https://yourserver/api/video?channel=1
```

**Catchup-specific tags:**
- `catchup="vod"` - Indicates server-side timeshift (VOD-style)
- `catchup-days="N"` - Number of days of catchup available
- `catchup-source="URL"` - Template URL with player-substituted variables:
  - `${start}` - Unix timestamp of the requested program start
  - `${timestamp}` - Unix timestamp of the current time
  - `${end}` - Unix timestamp of the requested program end
  - `${duration}` - Duration in seconds

### Catchup-Only M3U Playlist (`/catchup.m3u`)

A dedicated playlist containing only channels with catchup enabled:

- **URL**: `/catchup.m3u`
- **Method**: GET
- **Format**: M3U (application/vnd.apple.mpegurl)
- **Use Case**: For players that need a separate catchup playlist, or to only expose catchup-capable channels

This playlist includes additional tags:
- `catchup-correction="0"` - Timezone correction in seconds (UTC = 0)

### XMLTV Guide (`/media.xml`)

The XMLTV guide is enhanced with catchup metadata:

**Channel element:**
```xml
<channel id="My Channel" catchup="24">
  <display-name>My Channel</display-name>
  <url>https://yourserver/api/video?channel=1&catchup=true&utc=${start}&lutc=${timestamp}</url>
</channel>
```

**Programme element (for catchup-eligible programs):**
```xml
<programme start="20240115120000 +0000" stop="20240115130000 +0000" channel="My Channel" catchup-id="program-uuid">
  <title lang="en">Show Title</title>
  <previously-shown start="20240115120000 +0000" />
  <!-- ... other metadata ... -->
</programme>
```

- `catchup` attribute on `<channel>`: Window in hours
- `catchup-id` on `<programme>`: Unique program identifier for catchup requests
- `<previously-shown>`: Indicates the program has already aired and is available for catchup

### Catchup API (`/api/catchup`)

A REST endpoint for programmatic access to catchup information:

**Get catchup stream info for a specific time:**
```
GET /api/catchup?channel=1&time=2024-01-15T12:30:00Z
```

Response:
```json
{
  "channelNumber": 1,
  "program": {
    "id": "program-uuid",
    "title": "Show Title",
    "startTime": "2024-01-15T12:00:00.000Z",
    "endTime": "2024-01-15T13:00:00.000Z"
  },
  "videoUrl": "https://plex-server:32400/library/...",
  "seekOffset": 1800,
  "remainingDuration": 1800,
  "catchupExpiry": "2024-01-16T13:00:00.000Z"
}
```

**Get catchup stream info by program ID:**
```
GET /api/catchup?programId=program-uuid
```

**List all catchup-available programs for a channel:**
```
GET /api/catchup?channel=1
```

### Video Streaming (`/api/video`)

The video endpoint accepts catchup parameters:

```
GET /api/video?channel=1&catchup=true&utc=1705320600&lutc=1705322400
```

Parameters:
- `channel` - Channel number
- `catchup=true` - Indicates a catchup request
- `utc` - Unix timestamp of the requested start time
- `lutc` - Unix timestamp of the current/end time
- `time` - Alternative: ISO 8601 timestamp

## Web UI Features

### EPG Guide

The program guide supports catchup navigation:

- **Time navigation**: Browse up to 48 hours into the past using the time navigation controls
- **Visual indicators**: Past programs eligible for catchup display a rewind icon
- **One-click playback**: Click any catchup-eligible program in the guide to start watching
- **Color coding**:
  - Green border = Currently airing
  - Amber/orange with rewind icon = Available for catchup
  - Muted/dimmed = Past program, catchup expired

### Video Player

When watching a catchup stream:

- **CATCHUP badge**: Amber badge replaces the LIVE indicator
- **Jump to Live**: Button to return to live playback
- **Progress bar**: Shows playback position within the program
- **Keyboard controls**: Arrow keys for seeking within the catchup stream

## Database Schema

### Channel Model Extensions

```prisma
model Channel {
  // ... existing fields ...
  catchupEnabled      Boolean @default(true)   // Enable catchup for this channel
  catchupWindowHours  Int     @default(24)      // Hours of catchup available (1-48)
}
```

### Program Model Extensions

```prisma
model Program {
  // ... existing fields ...
  catchupAvailable Boolean  @default(true)  // Can this program be caught up?
  catchupExpiry    DateTime?                // When catchup expires (auto-calculated)
}
```

### Global Settings Extensions

```prisma
model Settings {
  // ... existing fields ...
  catchupEnabled       Boolean @default(true)  // Global catchup toggle
  catchupDefaultWindow Int     @default(24)     // Default window for new channels (hours)
}
```

## Architecture

### CatchupService

Located at `apps/server/src/lib/catchup-service.ts`, this service centralizes all catchup logic:

- `getProgramAtTime(channelNumber, requestedTime)` - Find which program was airing at a given time
- `getProgramById(programId)` - Find a program by its database ID
- `getCatchupStreamInfo(channel, time | programId)` - Build a complete stream URL with seek offset
- `listCatchupPrograms(channelNumber)` - List all currently catchup-eligible programs
- `isCatchupAvailable(channelNumber)` - Check if a channel supports catchup

### TimingService Extensions

Located at `apps/server/src/lib/timing-service.ts`, these static methods handle catchup timing:

- `calculateCatchupWindow(channel, now)` - Determine the start/end of the catchup window
- `isProgramCatchupAvailable(program, channel, now)` - Check if a specific program is eligible
- `getCatchupSeekOffset(program, requestedTime)` - Calculate the FFmpeg seek offset in milliseconds
- `calculateCatchupExpiry(programEndTime, windowHours)` - Compute when catchup expires for a program

## Troubleshooting

### Catchup not appearing in IPTV player

1. Verify global catchup is enabled in **Settings**
2. Verify the channel has catchup enabled (edit channel > Catchup / Timeshift)
3. Ensure your player supports `catchup="vod"` tags
4. Try using the dedicated `/catchup.m3u` playlist
5. Refresh the playlist in your player to pick up new tags

### Catchup stream won't play

1. Check that the Plex media file is still available and accessible
2. Verify the program is within the catchup window (not expired)
3. Check server logs for FFmpeg errors at `/api/video`
4. Ensure the Plex server is online and the token is valid

### Programs showing as expired too quickly

1. Increase the channel's **Catchup Window** in channel settings
2. Increase the **Default Catchup Window** in global settings for new channels
3. Note: The catchup window is calculated from the program's **end time**, not its start time

### Performance considerations

- Catchup uses Plex's native seeking, so there is no additional storage overhead
- Each catchup stream uses the same FFmpeg pipeline as live streams
- The `concurrentStreams` setting in global settings applies to both live and catchup streams combined
- XMLTV generation includes catchup metadata and may be slightly slower with many channels; caching is in place (5-minute TTL)
