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
    xmltv += '<tv generator-info-name="dizqueTV" generator-info-url="https://github.com/vexorian/dizquetv" source-info-name="dizqueTV">\n';
    for (const channel of channels) {
      xmltv += `  <channel id="${escapeXml(channel.number.toString())}">\n`;
      xmltv += `    <display-name lang="en">${escapeXml(channel.name)}</display-name>\n`;
      xmltv += `    <display-name>${escapeXml(channel.number.toString())}</display-name>\n`;
      if (channel.icon) {
        xmltv += `    <icon src="${escapeXml(channel.icon)}" />\n`;
      }
      if (channel.groupTitle) {
        xmltv += `    <display-name>${escapeXml(channel.groupTitle)}</display-name>\n`;
      }
      xmltv += '  </channel>\n';
    }
    for (const program of programs) {
      const programStartTime = new Date(program.startTime);
      const programEndTime = new Date(programStartTime.getTime() + program.duration);
      xmltv += `  <programme start="${formatXmltvTime(programStartTime)}" stop="${formatXmltvTime(programEndTime)}" channel="${escapeXml(program.channel.number.toString())}">\n`;
      if (program.episode) {
        const show = program.episode.show;
        xmltv += `    <title lang="en">${escapeXml(show.title)}</title>\n`;
        if (program.episode.title && program.episode.title.trim() !== '') {
          xmltv += `    <sub-title lang="en">${escapeXml(program.episode.title)}</sub-title>\n`;
        }
        const seasonStr = program.episode.seasonNumber.toString().padStart(2, '0');
        const episodeStr = program.episode.episodeNumber.toString().padStart(2, '0');
        let desc = `Season ${program.episode.seasonNumber}, Episode ${program.episode.episodeNumber}`;
        if (program.episode.summary && program.episode.summary.trim() !== '') {
          desc += `\n\n${program.episode.summary}`;
        } else if (show.summary && show.summary.trim() !== '') {
          desc += `\n\n${show.summary}`;
        }
        xmltv += `    <desc lang="en">${escapeXml(desc)}</desc>\n`;
        xmltv += `    <category lang="en">Series</category>\n`;
        if (show.genres && show.genres.trim() !== '') {
          try {
            const genres = JSON.parse(show.genres);
            if (Array.isArray(genres)) {
              genres.forEach(genre => {
                xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
              });
            }
          } catch (e) {
            const genres = show.genres.split(',').map(g => g.trim()).filter(g => g);
            genres.forEach(genre => {
              xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
            });
          }
        }
        xmltv += `    <episode-num system="onscreen">S${seasonStr}E${episodeStr}</episode-num>\n`;
        xmltv += `    <episode-num system="xmltv_ns">${program.episode.seasonNumber - 1}.${program.episode.episodeNumber - 1}.</episode-num>\n`;
        if (show.poster) {
          xmltv += `    <icon src="${escapeXml(show.poster)}" />\n`;
        }
        if (show.actors && show.actors.trim() !== '') {
          xmltv += '    <credits>\n';
          try {
            const actors = JSON.parse(show.actors);
            if (Array.isArray(actors)) {
              actors.forEach((actor: string) => {
                xmltv += `      <actor>${escapeXml(actor)}</actor>\n`;
              });
            }
          } catch (e) {
            const actors = show.actors.split(',').map(a => a.trim()).filter(a => a);
            actors.forEach(actor => {
              xmltv += `      <actor>${escapeXml(actor)}</actor>\n`;
            });
          }
          xmltv += '    </credits>\n';
        }
        if (show.contentRating) {
          xmltv += `    <rating system="MPAA">\n`;
          xmltv += `      <value>${escapeXml(show.contentRating)}</value>\n`;
          xmltv += `    </rating>\n`;
        }
      } else if (program.movie) {
        xmltv += `    <title lang="en">${escapeXml(program.movie.title)}</title>\n`;
        let desc = '';
        if (program.movie.summary && program.movie.summary.trim() !== '') {
          desc = program.movie.summary;
        }
        if (desc) {
          xmltv += `    <desc lang="en">${escapeXml(desc)}</desc>\n`;
        }
        if (program.movie.year) {
          xmltv += `    <date>${program.movie.year}</date>\n`;
        }
        xmltv += `    <category lang="en">Movie</category>\n`;
        if (program.movie.genres && program.movie.genres.trim() !== '') {
          try {
            const genres = JSON.parse(program.movie.genres);
            if (Array.isArray(genres)) {
              genres.forEach((genre: string) => {
                xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
              });
            }
          } catch (e) {
            const genres = program.movie.genres.split(',').map(g => g.trim()).filter(g => g);
            genres.forEach(genre => {
              xmltv += `    <category lang="en">${escapeXml(genre)}</category>\n`;
            });
          }
        }
        if (program.movie.poster) {
          xmltv += `    <icon src="${escapeXml(program.movie.poster)}" />\n`;
        }
        if (program.movie.actors && program.movie.actors.trim() !== '') {
          xmltv += '    <credits>\n';
          try {
            const actors = JSON.parse(program.movie.actors);
            if (Array.isArray(actors)) {
              actors.forEach((actor: string) => {
                xmltv += `      <actor>${escapeXml(actor)}</actor>\n`;
              });
            }
          } catch (e) {
            const actors = program.movie.actors.split(',').map(a => a.trim()).filter(a => a);
            actors.forEach(actor => {
              xmltv += `      <actor>${escapeXml(actor)}</actor>\n`;
            });
          }
          xmltv += '    </credits>\n';
        }
        if (program.movie.directors && program.movie.directors.trim() !== '') {
          xmltv += '    <credits>\n';
          try {
            const directors = JSON.parse(program.movie.directors);
            if (Array.isArray(directors)) {
              directors.forEach((director: string) => {
                xmltv += `      <director>${escapeXml(director)}</director>\n`;
              });
            }
          } catch (e) {
            const directors = program.movie.directors.split(',').map(d => d.trim()).filter(d => d);
            directors.forEach(director => {
              xmltv += `      <director>${escapeXml(director)}</director>\n`;
            });
          }
          xmltv += '    </credits>\n';
        }
        if (program.movie.contentRating) {
          xmltv += `    <rating system="MPAA">\n`;
          xmltv += `      <value>${escapeXml(program.movie.contentRating)}</value>\n`;
          xmltv += `    </rating>\n`;
        }
        if (program.movie.duration) {
          const runtimeMinutes = Math.round(program.movie.duration / 60000);
          xmltv += `    <length units="minutes">${runtimeMinutes}</length>\n`;
        }
      }
      const programStart = programStartTime.getTime();
      const programEnd = programEndTime.getTime();
      const currentTime = now.getTime();
      if (currentTime >= programStart && currentTime <= programEnd) {
        xmltv += `    <live />\n`;
      } else if (programStart > currentTime) {
        const timeDiff = programStart - currentTime;
        if (timeDiff < 24 * 60 * 60 * 1000) {
          xmltv += `    <new />\n`;
        }
      }
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