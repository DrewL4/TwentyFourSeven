import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * XMLTV Guide Generator - Timezone Best Practices Implementation
 * 
 * This implementation follows XMLTV specification best practices for time handling:
 * 
 * 1. XMLTV times are UTC by definition - The format includes local wall time + UTC offset
 * 2. Two timezone considerations:
 *    - Source timezone: Where the TV guide data originates (server timezone)
 *    - Target timezone: Where the user/IPTV player is located
 * 
 * 3. Our approach:
 *    - Generate times in server's local timezone (source) with proper UTC offset
 *    - IPTV players handle conversion to user's timezone (target)
 *    - This ensures compatibility with all XMLTV-compliant applications
 * 
 * 4. Format: yyyyMMddhhmmss +/-hhmm
 *    - First part: Local wall time at source
 *    - Second part: UTC offset for conversion
 *    - Example: "20240101120000 -0500" = 12:00 local time, UTC-5 offset
 * 
 * This approach ensures maximum compatibility with IPTV players, PVRs, and other
 * XMLTV consumers while following W3C timezone best practices.
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
 * Formats a Date object into XMLTV time format following best practices.
 * 
 * XMLTV Best Practices for Time:
 * - Times should be in UTC by definition according to XMLTV specification
 * - Format: yyyyMMddhhmmss +/-hhmm (local time + UTC offset)
 * - The first part represents the local wall time at the source
 * - The second part is the UTC offset to convert to actual UTC time
 * - This allows IPTV players to correctly handle timezone conversion
 * 
 * Example: "20240101120000 -0500" means:
 * - Local time: 2024-01-01 12:00:00 in a timezone that is UTC-5
 * - Actual UTC time: 2024-01-01 17:00:00
 * 
 * @param date - The Date object to format
 * @returns XMLTV formatted time string
 */
function formatXmltvTime(date: Date): string {
  // Get the server's timezone offset in minutes
  const serverTimezoneOffset = -date.getTimezoneOffset();
  
  // Format the offset as +/-hhmm
  const sign = serverTimezoneOffset >= 0 ? '+' : '-';
  const offsetHours = Math.floor(Math.abs(serverTimezoneOffset) / 60).toString().padStart(2, '0');
  const offsetMinutes = (Math.abs(serverTimezoneOffset) % 60).toString().padStart(2, '0');
  const timezoneOffset = `${sign}${offsetHours}${offsetMinutes}`;
  
  // Format the date in local time (what users see on their wall clock)
  // This represents the "wall time" in the server's timezone
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  
  // Return in XMLTV format: yyyyMMddhhmmss +/-hhmm
  return `${year}${month}${day}${hours}${minutes}${seconds} ${timezoneOffset}`;
}

export async function GET(request: NextRequest) {
  try {
    const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
    const guideDays = settings?.guideDays || 3;
    const channels = await prisma.channel.findMany({ where: { stealth: false }, orderBy: { number: 'asc' } });
    const now = new Date();
    const startTime = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const endTime = new Date(now.getTime() + guideDays * 24 * 60 * 60 * 1000);
    const programs = await prisma.program.findMany({
      where: { startTime: { gte: startTime, lte: endTime } },
      include: { channel: true, episode: { include: { show: true } }, movie: true },
      orderBy: [ { channel: { number: 'asc' } }, { startTime: 'asc' } ]
    });
    let xmltv = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xmltv += '<!DOCTYPE tv SYSTEM "xmltv.dtd">\n';
    xmltv += '<tv generator-info-name="TwentyFourSeven" generator-info-url="https://github.com/vexorian/TwentyFourSeven" source-info-name="TwentyFourSeven">\n';
    for (const channel of channels) {
      // Use the exact channel name for XML id to align with M3U tvg-id
      const channelId = escapeXml(channel.name);
      xmltv += `  <channel id="${channelId}">\n`;
      // Emit a single display-name without attributes to avoid list/dict parsing in xmltodict
      xmltv += `    <display-name>${escapeXml(channel.name)}</display-name>\n`;
      if (channel.icon) {
        xmltv += `    <icon src="${escapeXml(channel.icon)}" />\n`;
      }
      xmltv += '  </channel>\n';
    }
    for (const program of programs) {
      const programStartTime = new Date(program.startTime);
      const programEndTime = new Date(programStartTime.getTime() + program.duration);
      // Use the same channelId logic for programme channel reference
      const channelId = escapeXml(program.channel.name);
      xmltv += `  <programme start="${formatXmltvTime(programStartTime)}" stop="${formatXmltvTime(programEndTime)}" channel="${channelId}">\n`;
      if (program.episode) {
        const show = program.episode.show;
        xmltv += `    <title lang="en">${escapeXml(show.title)}</title>\n`;
        if (program.episode.title && program.episode.title.trim() !== '') {
          xmltv += `    <sub-title lang="en">${escapeXml(program.episode.title)}</sub-title>\n`;
        }
        const seasonStr = program.episode.seasonNumber.toString().padStart(2, '0');
        const episodeStr = program.episode.episodeNumber.toString().padStart(2, '0');

        // Build enriched description: SXX EXX, blank line, summary, blank line, Cast
        let summary = '';
        if (program.episode.summary && program.episode.summary.trim() !== '') {
          summary = program.episode.summary;
        } else if (show.summary && show.summary.trim() !== '') {
          summary = show.summary;
        }

        let actorList: string[] = [];
        if (show.actors && show.actors.trim() !== '') {
          try {
            const actors = JSON.parse(show.actors);
            if (Array.isArray(actors)) {
              actorList = actors.filter((a: any) => typeof a === 'string' && a.trim() !== '');
            }
          } catch (e) {
            actorList = show.actors
              .split(',')
              .map((a: string) => a.trim())
              .filter((a: string) => a);
          }
        }

        const descLines: string[] = [];
        descLines.push(`S${seasonStr} E${episodeStr}`);
        if (summary) {
          descLines.push('');
          descLines.push(summary);
        }
        if (actorList.length > 0) {
          descLines.push('');
          descLines.push(`Cast: ${actorList.join(', ')}`);
        }
        xmltv += `    <desc lang="en">${escapeXml(descLines.join('\n'))}</desc>\n`;

        xmltv += `    <category lang="en">Series</category>\n`;
        if (show.genres && show.genres.trim() !== '') {
          try {
            const genres = JSON.parse(show.genres);
            if (Array.isArray(genres)) {
              genres.forEach((genre: string) => {
                xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
              });
            }
          } catch (e) {
            const genres = show.genres.split(',').map((g: string) => g.trim()).filter((g: string) => g);
            genres.forEach((genre: string) => {
              xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
            });
          }
        }
        xmltv += `    <episode-num system="onscreen">S${seasonStr}E${episodeStr}</episode-num>\n`;
        xmltv += `    <episode-num system="xmltv_ns">${program.episode.seasonNumber - 1}.${program.episode.episodeNumber - 1}.</episode-num>\n`;
        if (show.poster) {
          xmltv += `    <icon src="${escapeXml(show.poster)}" />\n`;
        }
        if (actorList.length > 0) {
          xmltv += '    <credits>\n';
          actorList.forEach((actor: string) => {
            xmltv += `      <actor>${escapeXml(actor)}</actor>\n`;
          });
          xmltv += '    </credits>\n';
        }
        if (show.contentRating) {
          // Use VCHIP for TV ratings like "TV-PG", fallback to MPAA otherwise
          const ratingSystem = show.contentRating.startsWith('TV-') ? 'VCHIP' : 'MPAA';
          xmltv += `    <rating system="${ratingSystem}">\n`;
          xmltv += `      <value>${escapeXml(show.contentRating)}</value>\n`;
          xmltv += `    </rating>\n`;
        }
      } else if (program.movie) {
        xmltv += `    <title lang="en">${escapeXml(program.movie.title)}</title>\n`;

        // Enriched movie description: summary, blank line, Credits (Cast/Director)
        const movieSummary = (program.movie.summary && program.movie.summary.trim() !== '') ? program.movie.summary : '';

        let movieActors: string[] = [];
        if (program.movie.actors && program.movie.actors.trim() !== '') {
          try {
            const actors = JSON.parse(program.movie.actors);
            if (Array.isArray(actors)) {
              movieActors = actors.filter((a: any) => typeof a === 'string' && a.trim() !== '');
            }
          } catch (e) {
            movieActors = program.movie.actors
              .split(',')
              .map((a: string) => a.trim())
              .filter((a: string) => a);
          }
        }

        let movieDirectors: string[] = [];
        if (program.movie.directors && program.movie.directors.trim() !== '') {
          try {
            const directors = JSON.parse(program.movie.directors);
            if (Array.isArray(directors)) {
              movieDirectors = directors.filter((d: any) => typeof d === 'string' && d.trim() !== '');
            }
          } catch (e) {
            movieDirectors = program.movie.directors
              .split(',')
              .map((d: string) => d.trim())
              .filter((d: string) => d);
          }
        }

        const movieDescLines: string[] = [];
        if (movieSummary) {
          movieDescLines.push(movieSummary);
        }
        if (movieActors.length > 0 || movieDirectors.length > 0) {
          if (movieDescLines.length > 0) movieDescLines.push('');
          if (movieActors.length > 0) movieDescLines.push(`Cast: ${movieActors.join(', ')}`);
          if (movieDirectors.length > 0) movieDescLines.push(`Director: ${movieDirectors.join(', ')}`);
        }
        if (movieDescLines.length > 0) {
          xmltv += `    <desc lang="en">${escapeXml(movieDescLines.join('\n'))}</desc>\n`;
        }

        if (program.movie.year) {
          xmltv += `    <date>${program.movie.year}</date>\n`;
        }

        // Movie categories from genres
        if (program.movie.genres && program.movie.genres.trim() !== '') {
          try {
            const genres = JSON.parse(program.movie.genres);
            if (Array.isArray(genres)) {
              genres.forEach((genre: string) => {
                xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
              });
            }
          } catch (e) {
            const genres = program.movie.genres.split(',').map((g: string) => g.trim()).filter((g: string) => g);
            genres.forEach((genre: string) => {
              xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
            });
          }
        }

        // Movie poster as icon if available
        if (program.movie.poster) {
          xmltv += `    <icon src="${escapeXml(program.movie.poster)}" />\n`;
        }

        // Movie credits (actors/directors)
        if (movieActors.length > 0 || movieDirectors.length > 0) {
          xmltv += '    <credits>\n';
          movieActors.forEach((actor: string) => {
            xmltv += `      <actor>${escapeXml(actor)}</actor>\n`;
          });
          movieDirectors.forEach((director: string) => {
            xmltv += `      <director>${escapeXml(director)}</director>\n`;
          });
          xmltv += '    </credits>\n';
        }

        // Rating for movies: prefer MPAA
        if (program.movie.contentRating) {
          const ratingSystem = program.movie.contentRating.startsWith('TV-') ? 'VCHIP' : 'MPAA';
          xmltv += `    <rating system="${ratingSystem}">\n`;
          xmltv += `      <value>${escapeXml(program.movie.contentRating)}</value>\n`;
          xmltv += `    </rating>\n`;
        }
        // Close the programme element for movies
      }
      // Optionally add <live /> or <new /> tags as in the original logic if needed
      xmltv += '  </programme>\n';
    }
    xmltv += '</tv>';
    return new NextResponse(xmltv, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="xmltv.xml"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    console.error('Error generating XMLTV:', error);
    return NextResponse.json({ error: 'Failed to generate XMLTV guide' }, { status: 500 });
  }
}