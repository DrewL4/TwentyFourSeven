import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getXmlTvCachePath,
  readXmlTvCacheIfFresh,
  writeXmlTvCacheStreaming,
} from "@/lib/xmltv-static-cache";
import { readFile } from "fs/promises";

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * XMLTV Guide Generator - Timezone Best Practices Implementation
 * 
 * We emit all programme times in UTC with an explicit +0000 offset. While XMLTV
 * allows local wall time plus an offset, using UTC avoids DST edge cases and
 * ensures consistent interpretation across clients.
 * 
 * Format: yyyyMMddhhmmss +0000 (UTC time with UTC offset)
 * Example: "20240101120000 +0000" = 2024-01-01 12:00:00 UTC
 */

function escapeXml(text: string | number): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Formats a Date object into XMLTV time format (UTC best practice).
 *
 * - We output UTC clock time with a +0000 offset to avoid DST ambiguity.
 * - Format: yyyyMMddhhmmss +0000
 *
 * @param date - The Date object to format
 * @returns XMLTV formatted UTC time string
 */
function formatXmltvTime(date: Date): string {
  const year = date.getUTCFullYear().toString();
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  const seconds = date.getUTCSeconds().toString().padStart(2, '0');
  const timezoneOffset = "+0000";
  return `${year}${month}${day}${hours}${minutes}${seconds} ${timezoneOffset}`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const bypassCache = searchParams.get('bypass-cache') === 'true';

    if (!bypassCache) {
      const cachedXml = await readXmlTvCacheIfFresh(CACHE_DURATION);
      if (cachedXml) {
        return new NextResponse(cachedXml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Content-Disposition": 'attachment; filename="xmltv.xml"',
            "Cache-Control": "public, max-age=300",
            "X-Cache": "HIT-DISK",
          },
        });
      }
    }

    const startTime = performance.now();

    const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
    const guideDays = settings?.guideDays || 3;
    const globalCatchupEnabled = settings?.catchupEnabled ?? true;
    const settingsLoadTime = performance.now();

    const channels = await prisma.channel.findMany({ where: { stealth: false }, orderBy: { number: 'asc' } });

    // Helper to ensure absolute URLs
    const isAbsolute = (url?: string | null) => !!url && /^(https?:)?\/\//i.test(url);
    const toPlexProxy = (baseUrl: string, url: string): string => {
      const u = new URL(url);
      u.searchParams.delete('X-Plex-Token');
      const pathWithQuery = u.pathname + (u.search ? u.search : '');
      return `${baseUrl}/images/plex?origin=${encodeURIComponent(u.origin)}&path=${encodeURIComponent(pathWithQuery)}`;
    };

    // Force HTTPS for all URLs
    const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '247.midweststreams.us';
    const baseUrl = `https://${forwardedHost}`;

    const queryNow = new Date();
    const queryStartTime = new Date(queryNow.getTime() - 4 * 60 * 60 * 1000);
    const queryEndTime = new Date(queryNow.getTime() + guideDays * 24 * 60 * 60 * 1000);

    const programs = await prisma.program.findMany({
      where: { startTime: { gte: queryStartTime, lte: queryEndTime } },
      include: {
        channel: true,
        episode: {
          include: {
            show: {
              select: {
                id: true,
                title: true,
                poster: true,
                summary: true,
                genres: true,
                actors: true,
                contentRating: true
              }
            }
          }
        },
        movie: {
          select: {
            id: true,
            title: true,
            poster: true,
            summary: true,
            year: true,
            genres: true,
            actors: true,
            directors: true,
            contentRating: true,
            duration: true
          }
        }
      },
      orderBy: [ { channel: { number: 'asc' } }, { startTime: 'asc' } ]
    });
    const programsLoadTime = performance.now();

    const expectedProgramsPerChannel = Math.round(programs.length / channels.length);
    const programsPerDay = Math.round(programs.length / guideDays);

    // Log warning for large datasets that may cause slow XMLTV generation
    if (programs.length > 1000) {
    }

    // Check for channels without programming and log warnings
    const channelsWithPrograms = new Set(programs.map(p => p.channel.id));
    const channelsWithoutPrograms = channels.filter(c => !channelsWithPrograms.has(c.id));

    if (channelsWithoutPrograms.length > 0) {
      console.warn(`⚠️ XMLTV Warning: ${channelsWithoutPrograms.length} channels have no programming in the requested time range:`);
      channelsWithoutPrograms.forEach(channel => {
        console.warn(`   - Channel ${channel.number}: ${channel.name} (ID: ${channel.id})`);
      });
      console.warn('💡 This indicates these channels need program generation. Run the "Ensure All Channels Have Programming" API endpoint.');
    }

    // Use pre-cached channel icons for maximum performance
    const channelIconMap = new Map<string, string>();

    // Process channel icons using cached/optimized data
    for (const channel of channels) {
      // Use direct channel icon if available
      if (isAbsolute(channel.icon)) {
        try {
          const u = new URL(channel.icon as string);
          channelIconMap.set(channel.id, u.searchParams.has('X-Plex-Token') ? toPlexProxy(baseUrl, channel.icon as string) : (channel.icon as string));
          continue;
        } catch {}
      }

      // Use pre-cached Plex collection artwork if available
    if (channel.cachedCollectionIcon) {
      channelIconMap.set(channel.id, channel.cachedCollectionIcon);
      continue;
    }

    // For now, use direct channel icon to test the system
    // TODO: Implement collection icon caching in channel creation
    if (isAbsolute(channel.icon)) {
      try {
        const u = new URL(channel.icon as string);
        channelIconMap.set(channel.id, u.searchParams.has('X-Plex-Token') ? toPlexProxy(baseUrl, channel.icon as string) : (channel.icon as string));
        continue;
      } catch {}
    }

    // Fallback to programme poster (very fast)
    const program = programs.find(p => p.channelId === channel.id);
    const poster = program?.episode?.show?.poster || program?.movie?.poster || null;
    if (isAbsolute(poster)) {
      channelIconMap.set(channel.id, toPlexProxy(baseUrl, poster as string));
    }
    } // Close the for (const channel of channels) loop

    // Use array-based XML building for much better performance
    const xmltvParts = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE tv SYSTEM "xmltv.dtd">',
      '<tv generator-info-name="TwentyFourSeven" generator-info-url="https://github.com/vexorian/TwentyFourSeven" source-info-name="TwentyFourSeven">'
    ];

    // Build a map of channel catchup settings for use in programme elements
    const channelCatchupMap = new Map<string, { enabled: boolean; windowHours: number }>();

    for (const channel of channels) {
      const channelCatchup = globalCatchupEnabled && channel.catchupEnabled;
      channelCatchupMap.set(channel.id, {
        enabled: channelCatchup,
        windowHours: channel.catchupWindowHours,
      });

      // Use the exact channel name for XML id to align with M3U tvg-id
      const channelId = escapeXml(channel.name);

      // Include catchup attribute on channel element when enabled
      if (channelCatchup) {
        xmltvParts.push(`  <channel id="${channelId}" catchup="${escapeXml(String(channel.catchupWindowHours))}">`);
      } else {
        xmltvParts.push(`  <channel id="${channelId}">`);
      }
      // Emit a single display-name without attributes to avoid list/dict parsing in xmltodict
      xmltvParts.push(`    <display-name>${escapeXml(channel.name)}</display-name>`);
      const iconUrl = channelIconMap.get(channel.id) || (isAbsolute(channel.icon) ? (() => {
        try {
          const u = new URL(channel.icon as string);
          return u.searchParams.has('X-Plex-Token') ? toPlexProxy(baseUrl, channel.icon as string) : (channel.icon as string);
        } catch {
          return undefined;
        }
      })() : undefined);
      if (iconUrl) {
        xmltvParts.push(`    <icon src="${escapeXml(iconUrl)}" />`);
      }

      if (channelCatchup) {
        xmltvParts.push(`    <url catchup="vod" catchup-days="${Math.ceil(channel.catchupWindowHours / 24)}">${escapeXml(baseUrl)}/api/video?channel=${channel.number}&amp;catchup=true&amp;utc={start}&amp;lutc={timestamp}</url>`);
      }

      xmltvParts.push('  </channel>');
    }
    // Pre-build channel ID map to avoid repeated escaping
    const channelIdMap = new Map<string, string>();
    for (const channel of channels) {
      channelIdMap.set(channel.id, escapeXml(channel.name));
    }

    const xmlStartTime = performance.now();

    for (const program of programs) {
      const programStartTime = new Date(program.startTime);
      const programEndTime = new Date(programStartTime.getTime() + program.duration);
      // Use cached channel ID to avoid repeated escaping
      const channelId = channelIdMap.get(program.channelId) || escapeXml(program.channel.name);

      // Build programme attributes – add catchup-id when catchup is enabled
      const catchupInfo = channelCatchupMap.get(program.channelId);
      let programmeAttrs = `start="${formatXmltvTime(programStartTime)}" stop="${formatXmltvTime(programEndTime)}" channel="${channelId}"`;
      if (catchupInfo?.enabled && program.catchupAvailable) {
        programmeAttrs += ` catchup-id="${escapeXml(program.id)}"`;
      }
      xmltvParts.push(`  <programme ${programmeAttrs}>`);
      if (program.episode) {
        const show = program.episode.show;
        const episode = program.episode;

        const seasonStr = episode.seasonNumber.toString().padStart(2, '0');
        const episodeStr = episode.episodeNumber.toString().padStart(2, '0');
        const episodeNum = `S${seasonStr}E${episodeStr}`;
        const xmltvNsNum = `${episode.seasonNumber - 1}.${episode.episodeNumber - 1}.`;

        const episodeTitleRaw = episode.title?.trim() || show.title;
        const title = escapeXml(`${episodeTitleRaw} - ${episodeNum}`);
        const episodeDesc = episode.summary?.trim() || '';

        // Parse actors more efficiently
        let actorList: string[] = [];
        if (show.actors?.trim()) {
          try {
            const actors = JSON.parse(show.actors);
            if (Array.isArray(actors)) {
              actorList = actors.filter((a: any) => typeof a === 'string' && a.trim());
            }
          } catch {
            actorList = show.actors.split(',').map(a => a.trim()).filter(a => a);
          }
        }

        // Build all episode XML parts at once
        const episodeParts = [
          `    <title lang="en">${title}</title>`,
          episodeDesc ? `    <desc lang="en">${escapeXml(episodeDesc)}</desc>` : null,
          `    <category lang="en">Series</category>`,
          `    <episode-num system="onscreen">${episodeNum}</episode-num>`,
          `    <episode-num system="xmltv_ns">${xmltvNsNum}</episode-num>`
        ].filter(Boolean);

        // Add genres
        if (show.genres?.trim()) {
          try {
            const genres = JSON.parse(show.genres);
            if (Array.isArray(genres)) {
              genres.forEach(genre => {
                episodeParts.push(`    <category lang="en">${escapeXml(genre)}</category>`);
              });
            }
          } catch {
            const genres = show.genres.split(',').map(g => g.trim()).filter(g => g);
            genres.forEach(genre => {
              episodeParts.push(`    <category lang="en">${escapeXml(genre)}</category>`);
            });
          }
        }

        // Add poster if available
        if (show.poster && isAbsolute(show.poster)) {
          episodeParts.push(`    <icon src="${escapeXml(toPlexProxy(baseUrl, show.poster))}" />`);
        }

        // Add credits
        if (actorList.length > 0) {
          episodeParts.push('    <credits>');
          actorList.forEach(actor => {
            episodeParts.push(`      <actor>${escapeXml(actor)}</actor>`);
          });
          episodeParts.push('    </credits>');
        }

        // Add rating
        if (show.contentRating) {
          const ratingSystem = show.contentRating.startsWith('TV-') ? 'VCHIP' : 'MPAA';
          episodeParts.push(
            `    <rating system="${ratingSystem}">`,
            `      <value>${escapeXml(show.contentRating)}</value>`,
            `    </rating>`
          );
        }

        xmltvParts.push(...episodeParts.filter((part): part is string => part !== null));

        // Debug: Log progress every 100 programs
        if (xmltvParts.length % 100 === 0) {
        }
      } else if (program.movie) {
        const movie = program.movie;

        // Pre-compute values to reduce repeated operations
        const title = escapeXml(movie.title);
        const movieSummary = movie.summary?.trim() || '';

        // Parse actors and directors more efficiently
        let movieActors: string[] = [];
        if (movie.actors?.trim()) {
          try {
            const actors = JSON.parse(movie.actors);
            if (Array.isArray(actors)) {
              movieActors = actors.filter((a: any) => typeof a === 'string' && a.trim());
            }
          } catch {
            movieActors = movie.actors.split(',').map(a => a.trim()).filter(a => a);
          }
        }

        let movieDirectors: string[] = [];
        if (movie.directors?.trim()) {
          try {
            const directors = JSON.parse(movie.directors);
            if (Array.isArray(directors)) {
              movieDirectors = directors.filter((d: any) => typeof d === 'string' && d.trim());
            }
          } catch {
            movieDirectors = movie.directors.split(',').map(d => d.trim()).filter(d => d);
          }
        }

        // Build description lines more efficiently
        const movieDescLines = [];
        if (movieSummary) {
          movieDescLines.push(movieSummary);
        }
        if (movieActors.length > 0 || movieDirectors.length > 0) {
          if (movieDescLines.length > 0) movieDescLines.push('');
          if (movieActors.length > 0) movieDescLines.push(`Cast: ${movieActors.join(', ')}`);
          if (movieDirectors.length > 0) movieDescLines.push(`Director: ${movieDirectors.join(', ')}`);
        }

        // Build all movie XML parts at once
        const movieParts = [
          `    <title lang="en">${title}</title>`,
          movieDescLines.length > 0 ? `    <desc lang="en">${escapeXml(movieDescLines.join('\n'))}</desc>` : null,
          movie.year ? `    <date>${movie.year}</date>` : null
        ].filter(Boolean);

        // Add genres
        if (movie.genres?.trim()) {
          try {
            const genres = JSON.parse(movie.genres);
            if (Array.isArray(genres)) {
              genres.forEach(genre => {
                movieParts.push(`    <category lang="en">${escapeXml(genre)}</category>`);
              });
            }
          } catch {
            const genres = movie.genres.split(',').map(g => g.trim()).filter(g => g);
            genres.forEach(genre => {
              movieParts.push(`    <category lang="en">${escapeXml(genre)}</category>`);
            });
          }
        }

        // Add poster if available
        if (movie.poster && isAbsolute(movie.poster)) {
          movieParts.push(`    <icon src="${escapeXml(toPlexProxy(baseUrl, movie.poster))}" />`);
        }

        // Add credits
        if (movieActors.length > 0 || movieDirectors.length > 0) {
          movieParts.push('    <credits>');
          movieActors.forEach(actor => {
            movieParts.push(`      <actor>${escapeXml(actor)}</actor>`);
          });
          movieDirectors.forEach(director => {
            movieParts.push(`      <director>${escapeXml(director)}</director>`);
          });
          movieParts.push('    </credits>');
        }

        // Add rating
        if (movie.contentRating) {
          const ratingSystem = movie.contentRating.startsWith('TV-') ? 'VCHIP' : 'MPAA';
          movieParts.push(
            `    <rating system="${ratingSystem}">`,
            `      <value>${escapeXml(movie.contentRating)}</value>`,
            `    </rating>`
          );
        }

        xmltvParts.push(...movieParts.filter((part): part is string => part !== null));

        // Debug: Log progress every 100 programs
        if (xmltvParts.length % 100 === 0) {
        }
        // Close the programme element for movies
      }
      // Close the if/else if program type block
      // Add length and status indicators per guidelines
      const lengthMinutes = Math.round(program.duration / 60000);
      if (lengthMinutes > 0) {
        xmltvParts.push(`    <length units="minutes">${lengthMinutes}</length>`);
      }
      const currentNow = new Date();

      // Safety check: Ensure programStartTime and programEndTime are Date objects
      const startTime = programStartTime instanceof Date ? programStartTime : new Date(programStartTime);
      const endTime = programEndTime instanceof Date ? programEndTime : new Date(programEndTime);

      const isLive = currentNow >= startTime && currentNow < endTime;
      const isNewSoon = startTime > currentNow && (startTime.getTime() - currentNow.getTime()) <= 24 * 60 * 60 * 1000;
      if (isLive) {
        xmltvParts.push('    <live />');
      } else if (isNewSoon) {
        xmltvParts.push('    <new />');
      }

      // Mark past programmes that are still available for catchup
      const catchupMeta = channelCatchupMap.get(program.channelId);
      if (catchupMeta?.enabled && program.catchupAvailable && endTime < currentNow) {
        const windowStart = new Date(currentNow.getTime() - catchupMeta.windowHours * 60 * 60 * 1000);
        if (endTime > windowStart) {
          xmltvParts.push(`    <previously-shown start="${formatXmltvTime(startTime)}" />`);
        }
      }

      xmltvParts.push('  </programme>');
    } // Close the for (const program of programs) loop
    xmltvParts.push('</tv>');

    await writeXmlTvCacheStreaming(async (write) => {
      for (const part of xmltvParts) {
        write(part);
      }
    });

    const xmltv = await readFile(getXmlTvCachePath(), 'utf8');
    return new NextResponse(xmltv, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="xmltv.xml"',
        'Cache-Control': 'public, max-age=300',
        'X-Cache': 'MISS',
      },
    });
  } catch (error) {
    console.error('Error generating XMLTV:', error);
    return NextResponse.json({ error: 'Failed to generate XMLTV guide' }, { status: 500 });
  }
}