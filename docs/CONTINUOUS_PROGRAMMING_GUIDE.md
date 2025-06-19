# Continuous Programming Guide

## Overview

TwentyFour/Seven implements a sophisticated continuous programming system to ensure your channels never end. This system automatically maintains a rolling window of programming based on your configured guide days setting, ensuring viewers always have content to watch.

## How It Works

### 1. Initial Program Generation

When you first create a channel or add content to it:
- The system generates programming for the number of days specified in your `guideDays` setting (default: 3 days)
- Programs are created by cycling through your channel's content in the configured order
- Content loops automatically when it reaches the end, ensuring continuous playback

### 2. Automatic Maintenance

The system includes an automatic maintenance scheduler that:
- **Runs every hour** to check and extend programming as needed
- **Maintains the guide window** by ensuring programming always extends to the configured number of guide days
- **Cleans up old programs** from more than 24 hours ago to prevent database bloat
- **Preserves currently playing content** to avoid interrupting active streams

### 3. Seamless Transitions

The programming service ensures:
- **No gaps** between programs - each program starts exactly when the previous one ends
- **No overlaps** - the system automatically detects and resolves any scheduling conflicts
- **Content continuity** - when extending programming, it continues from where the last program ends

## Configuration

### Guide Days Setting

The `guideDays` setting (found in Settings) controls how far into the future programming is generated:
- Default: 3 days
- Recommended: 3-7 days
- Maximum practical: 14 days (larger values may impact performance)

### Channel Content Order

Programs are generated based on:
1. The order of shows/movies in your channel configuration
2. Episode order within shows (sequential by season/episode number)
3. Any shuffle or randomization settings you've configured

## Best Practices

### 1. Content Planning

- **Add sufficient content** to your channels to provide variety
- **Mix content types** (shows and movies) for better programming flow
- **Use channel automation** to automatically add new content based on filters

### 2. Performance Considerations

- The system generates programs efficiently by batching operations
- Automatic cleanup prevents database growth
- The hourly maintenance runs are lightweight and won't impact streaming

### 3. Manual Controls

While the system runs automatically, you can:
- **Manually regenerate** a channel's schedule from the channel settings
- **Force maintenance** from the Guide page using the "Maintain Programs" button
- **Generate specific durations** using the API if needed

## Technical Details

### Maintenance Schedule

The programming maintenance runs:
1. **On server startup** - Immediate check and generation if needed
2. **Every hour** - Regular maintenance to extend programming
3. **After content changes** - Automatic regeneration when adding/removing content

### Algorithm

The maintenance algorithm:
1. Checks each channel's last scheduled program
2. Calculates if programming extends far enough into the future
3. Appends new programs as needed to reach the guide days target
4. Maintains content rotation order across extensions

### Database Optimization

- Old programs (>24 hours) are automatically removed
- Indexes on `startTime` and `channelId` ensure fast queries
- Batch inserts minimize database load

## Troubleshooting

### Programs Not Generating

If programs aren't being generated:
1. Check that your channel has content assigned
2. Verify the content has valid duration metadata
3. Check server logs for any errors
4. Manually regenerate from the channel settings

### Gaps in Programming

If you see gaps:
1. The system will auto-repair on the next maintenance cycle
2. You can force immediate repair using "Maintain Programs"
3. Check for content with invalid or zero duration

### Performance Issues

If experiencing slowdowns:
1. Consider reducing `guideDays` to 3-5 days
2. Ensure automatic cleanup is running (check logs)
3. Verify you don't have an excessive number of channels

## Integration with Other Features

### Channel Automation

- New content added via automation triggers program regeneration
- Filters ensure only matching content is added
- Sort methods organize content before program generation

### Plex Webhooks

- Live content updates from Plex can trigger program updates
- New episodes are automatically incorporated into rotation

### Stream Generation

- The streaming system reads from the program schedule
- Currently playing programs are never modified
- Future programs can be updated without affecting active streams