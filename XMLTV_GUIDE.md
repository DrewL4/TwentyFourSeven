# XMLTV Guide Implementation

This document outlines the XMLTV guide implementation for the TV streaming application, ensuring it follows best practices and matches the UI guide data exactly.

## Overview

The XMLTV guide provides EPG (Electronic Program Guide) data in the industry-standard XMLTV format, compatible with various IPTV players, Plex, Jellyfin, and other media servers.

## Endpoints

### Primary XMLTV Endpoint
- **URL**: `/media.xml`
- **Method**: GET
- **Format**: XML (application/xml)
- **Usage**: Main endpoint for XMLTV guide data

### Validation Endpoint
- **URL**: `/api/stream/validate` (via RPC)
- **Method**: POST
- **Format**: JSON
- **Usage**: Validate XMLTV data consistency (admin only)

## Implementation Details

### Time Range
The XMLTV guide includes:
- **Past Programs**: 4 hours from current time (matches UI guide)
- **Future Programs**: Configurable via `guideDays` setting (default: 3 days)
- **Total Range**: ~3.2 days of programming data

### Channel Filtering
- Only includes **non-stealth** channels (matches M3U playlist)
- Channels sorted by number (ascending)
- All channel metadata included (name, number, icon, group)

### Program Data Structure

#### TV Show Episodes
```xml
<programme start="20241215120000 +0000" stop="20241215123000 +0000" channel="1">
  <title lang="en">Show Title</title>
  <sub-title lang="en">Episode Title</sub-title>
  <desc lang="en">Season 1, Episode 5

Episode description goes here...</desc>
  <category lang="en">Series</category>
  <category lang="en">Comedy</category>
  <episode-num system="onscreen">S01E05</episode-num>
  <episode-num system="xmltv_ns">0.4.</episode-num>
  <icon src="https://example.com/poster.jpg" />
  <credits>
    <actor>Actor Name</actor>
  </credits>
  <rating system="MPAA">
    <value>TV-PG</value>
  </rating>
</programme>
```

#### Movies
```xml
<programme start="20241215140000 +0000" stop="20241215160000 +0000" channel="2">
  <title lang="en">Movie Title</title>
  <desc lang="en">Movie description goes here...</desc>
  <date>2023</date>
  <category lang="en">Movie</category>
  <category lang="en">Action</category>
  <icon src="https://example.com/movie-poster.jpg" />
  <credits>
    <actor>Lead Actor</actor>
    <director>Director Name</director>
  </credits>
  <rating system="MPAA">
    <value>PG-13</value>
  </rating>
  <length units="minutes">120</length>
</programme>
```

### Data Processing

#### Genre Handling
Genres are stored as JSON arrays or comma-separated strings in the database:
```typescript
// JSON format (preferred)
genres: '["Comedy", "Drama", "Family"]'

// Fallback comma-separated
genres: 'Comedy, Drama, Family'
```

#### Cast & Crew Processing
Similar to genres, cast and crew data supports both formats:
```typescript
actors: '["John Doe", "Jane Smith"]'
directors: '["Director Name"]'
```

### Time Format
- **Format**: `YYYYMMDDHHMMSS ±HHMM`
- **Example**: `20241215120000 +0000`
- **Timezone**: Server's local timezone offset

### Status Indicators
- `<live />`: Currently airing programs
- `<new />`: Programs starting within 24 hours

## Best Practices Implemented

### XMLTV Standards Compliance
1. **Proper XML Declaration**: UTF-8 encoding
2. **DTD Reference**: Links to xmltv.dtd
3. **Required Elements**: All mandatory XMLTV elements included
4. **Time Format**: ISO-compliant timestamps with timezone
5. **Character Encoding**: Proper XML escaping for special characters

### Data Consistency
1. **Matches UI Guide**: Same time range and filtering logic
2. **No Overlaps**: Program validation prevents scheduling conflicts
3. **No Gaps**: Continuous programming with minimal breaks
4. **Valid Durations**: Programs between 1 minute and 24 hours

### Performance Optimizations
1. **Efficient Queries**: Single database query with proper joins
2. **Stealth Channel Filtering**: Excludes hidden channels
3. **Proper Caching Headers**: Prevents excessive requests
4. **Error Handling**: Graceful failure with helpful error messages

## Validation System

The built-in validation system checks for:

### Critical Errors (Must Fix)
- Programs without valid channel references
- Overlapping programs on same channel
- Invalid program durations (≤0 or >24 hours)
- Missing XML structure elements

### Warnings (Should Fix)
- Programs without episode or movie content
- Programming gaps >5 minutes
- Missing show/movie titles
- Programs beyond configured guide days
- Missing metadata (genres, cast, ratings)

### Usage
```typescript
// Via API endpoint (admin only)
const validation = await orpc.stream.validate.mutate();

// Direct validation
import { XmltvValidator } from '@/lib/xmltv-validator';
const report = await XmltvValidator.generateValidationReport();
```

## Configuration

### Guide Days Setting
- **Location**: Settings → Guide Configuration
- **Range**: 1-14 days
- **Default**: 3 days
- **Impact**: Affects both UI guide and XMLTV output

### Channel Settings
- **Stealth Channels**: Excluded from XMLTV (and M3U)
- **Channel Order**: Respected in output
- **Channel Icons**: Included when available

## Integration Examples

### Plex Integration
Add as "Live TV & DVR" source:
```
XMLTV URL: http://your-server:3000/media.xml
```

### Jellyfin Integration
Configure in "Live TV" settings:
```
XMLTV Path: http://your-server:3000/media.xml
```

### IPTV Players
Most IPTV players support XMLTV URLs for EPG data alongside M3U playlists.

## Troubleshooting

### Common Issues

1. **Empty Guide Data**
   - Check if channels have programming
   - Verify `guideDays` setting
   - Run validation endpoint

2. **Missing Programs**
   - Ensure programs are generated for channels
   - Check program start times vs. guide time range
   - Verify channel stealth settings

3. **Format Issues**
   - Validate XML structure
   - Check character encoding
   - Verify time format compliance

### Debug Tools

1. **Validation Endpoint**: `/api/stream/validate`
2. **Browser Inspection**: View raw XML in browser
3. **XMLTV Validators**: Use online XMLTV validation tools

## Maintenance

### Regular Tasks
1. **Monitor Guide Coverage**: Ensure adequate future programming
2. **Validate Data Quality**: Run validation checks periodically
3. **Clean Old Programs**: Automatic cleanup of past programs
4. **Monitor Performance**: Watch for slow XMLTV generation

### Best Practices
1. **Keep Guide Days Reasonable**: 3-7 days recommended
2. **Regular Program Generation**: Maintain continuous schedules
3. **Monitor Channel Content**: Ensure all channels have programming
4. **Update Metadata**: Keep show/movie information current

## Compatibility

### Tested With
- Plex Media Server
- Jellyfin
- Emby
- VLC Player
- Perfect Player
- TiviMate

### XMLTV Version
- Compatible with XMLTV DTD specification
- Follows XMLTV best practices
- Supports all major XMLTV elements 