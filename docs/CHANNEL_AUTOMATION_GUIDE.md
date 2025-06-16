# Channel Automation Feature Guide

## Overview

The Channel Automation feature allows you to automatically add new content to channels based on filter criteria. When you build a channel with specific filters (like actor: "Tom Hanks"), the system will remember those parameters and automatically add new movies or shows matching those criteria when they are added to your Plex server.

## How It Works

### 1. Database Schema Changes

New fields added to the `Channel` model:
- `autoFilterEnabled`: Boolean to enable/disable automation
- `filterGenres`: JSON string of genre filters
- `filterActors`: JSON string of actor filters  
- `filterDirectors`: JSON string of director filters
- `filterStudios`: JSON string of studio filters
- `filterYearStart`: Starting year for year range filter
- `filterYearEnd`: Ending year for year range filter
- `filterRating`: Content rating filter
- `filterType`: Type of content to filter ("movies", "shows", "both")
- `lastAutoScanAt`: Timestamp of last automation scan

### 2. Channel Automation Service

A new service (`ChannelAutomationService`) handles:
- Processing automation for all channels with `autoFilterEnabled: true`
- Applying saved filter criteria to new content
- Automatically adding matching content to channels
- Updating last scan timestamps

### 3. Integration with Plex Sync

The automation is triggered when:
- New movies are synced from Plex servers
- New TV shows are synced from Plex servers
- Manual automation processing is triggered

### 4. Frontend Changes

The Add Content dialog now includes:
- "Enable Channel Automation" checkbox
- Information explaining what automation does
- Filter saving functionality when content is added with automation enabled
- **Autocomplete inputs** for actors, directors, genres, and studios that pull from real metadata
- Search functionality with debounced API calls to avoid performance issues
- **Smart Filtering** feature that adapts filter options based on current selections

## Usage Instructions

### Setting Up Channel Automation

1. **Create or edit a channel** in the Channels page
2. **Click "Add Content"** to open the content dialog
3. **Set up your filters**:
   - **Actor**: Select multiple actors from your library (e.g., "Tom Hanks", "Adam Sandler") - content with ANY selected actor will be included
   - **Director**: Select multiple directors from your library (e.g., "Steven Spielberg", "Christopher Nolan") - content by ANY selected director will be included  
   - **Genre**: Select multiple genres from your library (e.g., "Comedy", "Action", "Drama") - content matching ANY selected genre will be included
   - **Studio**: Select multiple studios from your library (e.g., "Disney", "Warner Bros") - content from ANY selected studio will be included
   - **Year Range**: Enter specific years (e.g., 2000-2023)
   - **Rating**: Select from dropdown (e.g., "PG-13")
4. **Optional: Enable "Smart Filtering"** for contextual filter options (see Smart Filtering section below)
5. **Check "Enable Channel Automation"** checkbox
6. **Select and add content** as normal
7. The automation filters will be saved automatically

### What Happens Next

- When new content is added to your Plex server and synced, the system will check all channels with automation enabled
- If new content matches any channel's saved filter criteria, it will be automatically added to that channel
- Channel programs will be regenerated to include the new content
- You'll see console logs showing what content was auto-added

### Smart Filtering Feature

Smart Filtering is an advanced UI feature that makes filter selection more intelligent and prevents impossible filter combinations.

**How It Works:**
- When enabled, each filter selection dynamically updates the available options for other filters
- Only shows actors, directors, genres, studios, and ratings that actually exist in content matching your current filter selections
- Prevents creating filter combinations that would never match any content

**Example Workflow:**
1. Enable Smart Filtering checkbox
2. Select Actor: "Tom Hanks" 
3. The Director filter now only shows directors who have worked with Tom Hanks
4. The Genre filter only shows genres of Tom Hanks movies
5. The Studio filter only shows studios that have produced Tom Hanks movies
6. The Rating filter only shows ratings that exist for Tom Hanks movies

**Benefits:**
- **Prevents impossible combinations**: Can't select "Tom Hanks" + "Horror" if Tom Hanks has never been in a horror movie, or "Disney" + "R" if Disney has never made R-rated content
- **Discovers relationships**: Find out which directors have worked with specific actors, what ratings exist for specific studios
- **Improves accuracy**: Ensures your automation filters will actually match content
- **Saves time**: No need to guess which combinations exist in your library

**Visual Indicators:**
- Filter fields show a "Smart" badge when Smart Filtering is active
- Options dynamically update as you make selections
- Tooltip explains the feature when hovering over the checkbox

**Note**: Smart Filtering is a UI-only feature and doesn't affect the saved automation filters - it just helps you make better selections.

### Manual Automation Triggers

You can also manually trigger automation processing:

#### Via API endpoints:
- `POST /api/trpc/channels.processAutomation` - Process automation for a specific channel
- `POST /api/trpc/channels.processAllAutomation` - Process automation for all channels
- `POST /api/trpc/channels.updateFilters` - Update a channel's automation filters
- `GET /api/trpc/channels.getActors` - Get list of actors for autocomplete
- `GET /api/trpc/channels.getDirectors` - Get list of directors for autocomplete
- `GET /api/trpc/channels.getGenres` - Get list of genres for autocomplete
- `GET /api/trpc/channels.getStudios` - Get list of studios for autocomplete

#### Via Plex Sync:
- Automation runs automatically after movie and TV show sync operations

## Example Scenarios

### Scenario 1: Tom Hanks Movie Channel
1. Create a channel called "Tom Hanks Movies"
2. Add content with Actor filter: "Tom Hanks" and automation enabled
3. When a new Tom Hanks movie is added to Plex, it will automatically appear in this channel

### Scenario 2: Disney Comedy Channel  
1. Create a channel called "Disney Comedy"
2. Add content with Studio filter: "Disney", Genre filter: "Comedy", and automation enabled
3. New Disney comedies will automatically be added to this channel

### Scenario 3: Modern Action Movies
1. Create a channel called "Modern Action"
2. Add content with Genre filter: "Action", Year Range: 2020-2030, and automation enabled
3. New action movies from 2020 onwards will automatically be added

### Scenario 4: Multi-Actor Comedy Channel
1. Create a channel called "Comedy Legends"
2. Add content with Actor filters: "Tom Hanks", "Adam Sandler", "Jim Carrey" and Genre filter: "Comedy", and automation enabled
3. Any new comedy with any of these actors will automatically be added

### Scenario 5: Multi-Studio Superhero Channel
1. Create a channel called "Superhero Movies"
2. Add content with Studio filters: "Marvel Studios", "DC Entertainment", "Sony Pictures" and Genre filter: "Action", and automation enabled  
3. New superhero movies from any of these studios will automatically be added

### Scenario 6: Family-Friendly Disney Channel
1. Create a channel called "Disney Family Movies"
2. Enable Smart Filtering and select Studio: "Disney"
3. Rating filter now only shows ratings Disney actually uses (G, PG, PG-13, etc.)
4. Select Rating: "G" or "PG" for family-friendly content
5. Enable automation - only family-friendly Disney movies will be auto-added

## Technical Implementation Details

### Autocomplete System

The system now provides intelligent autocomplete for metadata fields:

**Backend Metadata Endpoints**:
- Extract unique values from both movies and TV shows
- Parse JSON metadata fields (actors, directors, genres)
- Support search filtering with case-insensitive matching
- Return sorted results with configurable limits

**Frontend Multi-Select Component**:
- Debounced search (300ms) to reduce API calls
- Real-time filtering as user types
- Multi-select with removable chips/tags for selected values
- Keyboard navigation support (Escape to close, Backspace to remove)
- Loading states and empty state handling
- Only allows selection of real values from the database
- Configurable maximum number of selections per field
- Scrollable dropdown with up to 200 options per field
- Visual indicator when many options are available

### Filter Matching Logic

The automation service uses flexible matching with OR logic for multi-select fields:
- **Actor filters**: Content matches if it contains ANY of the selected actors (case-insensitive substring matching)
- **Director filters**: Content matches if it contains ANY of the selected directors (case-insensitive substring matching)
- **Genre filters**: Content matches if it contains ANY of the selected genres (case-insensitive substring matching)
- **Studio filters**: Content matches if it's from ANY of the selected studios (case-insensitive substring matching)
- **Year filters**: Exact range matching (greater than or equal to start, less than or equal to end)
- **Rating filters**: Exact matching

**Multi-Select OR Logic**: For all metadata filters (actors, directors, genres, studios), if you select multiple values, content that matches ANY of those values will be included. This makes it easy to create channels like "Tom Hanks & Adam Sandler Movies" or "Comedy & Action Movies".

### Data Integrity

By using autocomplete with real metadata:
- **Eliminates typos** in filter criteria
- **Prevents "unknown" values** that would never match content
- **Ensures automation reliability** by using only existing values
- **Improves user experience** with instant feedback

### Performance Considerations

- Automation processing is batched and includes delays to avoid overwhelming the database
- Only channels with `autoFilterEnabled: true` are processed
- Filter matching is done in memory after basic database filtering for optimal performance

### Error Handling

- Automation failures are logged but don't affect normal Plex sync operations
- Individual channel automation failures don't stop processing of other channels
- Programming generation failures are logged but don't prevent content from being added

## Configuration

No additional configuration is required. The feature is ready to use once the database migration is applied and the code is deployed.

## Monitoring

Check your application logs for automation activity:
- `Auto-added movie "Movie Title" to channel "Channel Name"`
- `Auto-added show "Show Title" to channel "Channel Name"`
- Error logs if automation fails for specific channels

## Future Enhancements

Potential improvements for future versions:
- More sophisticated filter combinations (AND/OR logic)
- Keyword-based content filtering
- Automatic channel creation based on content patterns
- User notifications when content is auto-added
- Automation scheduling/timing controls
- Integration with webhooks for real-time automation

## Testing the Feature

1. **Set up automation** on a test channel with common filter criteria
2. **Manually add content** to your Plex server that matches the criteria
3. **Trigger a Plex sync** or manually call the automation endpoints
4. **Check the channel** to see if the new content was automatically added
5. **Review logs** for automation activity messages 