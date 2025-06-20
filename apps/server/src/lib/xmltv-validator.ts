import { prisma } from "./prisma";

export class XmltvValidator {
  /**
   * Validate that XMLTV data matches the database guide data
   */
  static async validateXmltvConsistency(): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    stats: {
      channelsInDb: number;
      channelsInXmltv: number;
      programsInDb: number;
      programsInXmltv: number;
    };
  }> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Get guide data from database (same logic as XMLTV route)
      const settings = await prisma.settings.findUnique({
        where: { id: "singleton" }
      });
      const guideDays = settings?.guideDays || 3;
      
      const channels = await prisma.channel.findMany({
        where: { stealth: false },
        orderBy: { number: 'asc' }
      });

      const now = new Date();
      const startTime = new Date(now.getTime() - 4 * 60 * 60 * 1000); // Past 4 hours
      const endTime = new Date(now.getTime() + guideDays * 24 * 60 * 60 * 1000);

      const programs = await prisma.program.findMany({
        where: {
          startTime: {
            gte: startTime,
            lte: endTime
          }
        },
        include: {
          channel: true,
          episode: {
            include: { show: true }
          },
          movie: true
        },
        orderBy: [
          { channel: { number: 'asc' } },
          { startTime: 'asc' }
        ]
      });

      // Validation checks
      
      // 1. Check for programs without channel
      const orphanPrograms = programs.filter(p => !p.channel);
      if (orphanPrograms.length > 0) {
        errors.push(`Found ${orphanPrograms.length} programs without valid channel references`);
      }

      // 2. Check for programs without content
      const programsWithoutContent = programs.filter(p => !p.episode && !p.movie);
      if (programsWithoutContent.length > 0) {
        warnings.push(`Found ${programsWithoutContent.length} programs without episode or movie content`);
      }

      // 3. Check for overlapping programs on same channel
      const channelGroups = programs.reduce((acc, program) => {
        const channelId = program.channel?.id;
        if (!channelId) return acc;
        
        if (!acc[channelId]) acc[channelId] = [];
        acc[channelId].push(program);
        return acc;
      }, {} as Record<string, typeof programs>);

      for (const [channelId, channelPrograms] of Object.entries(channelGroups)) {
        for (let i = 0; i < channelPrograms.length - 1; i++) {
          const current = channelPrograms[i];
          const next = channelPrograms[i + 1];
          
          const currentEnd = new Date(current.startTime).getTime() + current.duration;
          const nextStart = new Date(next.startTime).getTime();
          
          if (currentEnd > nextStart) {
            errors.push(`Overlapping programs detected on channel ${current.channel?.name || current.channel?.number}: "${current.episode?.show?.title || current.movie?.title}" overlaps with "${next.episode?.show?.title || next.movie?.title}"`);
          }
        }
      }

      // 4. Check for gaps in programming
      for (const [channelId, channelPrograms] of Object.entries(channelGroups)) {
        for (let i = 0; i < channelPrograms.length - 1; i++) {
          const current = channelPrograms[i];
          const next = channelPrograms[i + 1];
          
          const currentEnd = new Date(current.startTime).getTime() + current.duration;
          const nextStart = new Date(next.startTime).getTime();
          const gap = nextStart - currentEnd;
          
          if (gap > 5 * 60 * 1000) { // More than 5 minutes gap
            warnings.push(`Gap detected on channel ${current.channel?.name || current.channel?.number}: ${Math.round(gap / 60000)} minutes between programs`);
          }
        }
      }

      // 5. Check for missing episode/show data
      const showPrograms = programs.filter(p => p.episode);
      const missingShowTitles = showPrograms.filter(p => !p.episode?.show?.title);
      if (missingShowTitles.length > 0) {
        warnings.push(`${missingShowTitles.length} show episodes missing show titles`);
      }

      // 6. Check for missing movie data
      const moviePrograms = programs.filter(p => p.movie);
      const missingMovieTitles = moviePrograms.filter(p => !p.movie?.title);
      if (missingMovieTitles.length > 0) {
        warnings.push(`${missingMovieTitles.length} movie programs missing titles`);
      }

      // 7. Validate time formats and durations
      const invalidDurations = programs.filter(p => p.duration <= 0 || p.duration > 24 * 60 * 60 * 1000);
      if (invalidDurations.length > 0) {
        errors.push(`${invalidDurations.length} programs have invalid durations (<=0 or >24 hours)`);
      }

      // 8. Check for future programs beyond guide days
      const tooFarFuture = programs.filter(p => new Date(p.startTime) > endTime);
      if (tooFarFuture.length > 0) {
        warnings.push(`${tooFarFuture.length} programs scheduled beyond configured guide days (${guideDays})`);
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        stats: {
          channelsInDb: channels.length,
          channelsInXmltv: channels.filter(c => !c.stealth).length,
          programsInDb: programs.length,
          programsInXmltv: programs.filter(p => p.channel && !p.channel.stealth).length
        }
      };

    } catch (error) {
      errors.push(`Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return {
        isValid: false,
        errors,
        warnings,
        stats: {
          channelsInDb: 0,
          channelsInXmltv: 0,
          programsInDb: 0,
          programsInXmltv: 0
        }
      };
    }
  }

  /**
   * Validate XMLTV format compliance
   */
  static validateXmltvFormat(xmltv: string): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic XML structure checks
    if (!xmltv.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
      errors.push('Missing or incorrect XML declaration');
    }

    if (!xmltv.includes('<!DOCTYPE tv SYSTEM "xmltv.dtd">')) {
      warnings.push('Missing DTD declaration');
    }

    if (!xmltv.includes('<tv generator-info-name="TwentyFourSeven"')) {
      errors.push('Missing or incorrect TV root element');
    }

    // Check for required channel elements
    const channelMatches = xmltv.match(/<channel id="[^"]+"/g);
    if (!channelMatches || channelMatches.length === 0) {
      errors.push('No channels found in XMLTV');
    }

    // Check for display-name in channels
    const displayNameMatches = xmltv.match(/<display-name[^>]*>/g);
    if (!displayNameMatches || displayNameMatches.length === 0) {
      warnings.push('No display names found for channels');
    }

    // Check for programme elements
    const programmeMatches = xmltv.match(/<programme start="[^"]+"/g);
    if (!programmeMatches || programmeMatches.length === 0) {
      warnings.push('No programmes found in XMLTV');
    }

    // Check time format in programmes
    const timeFormatRegex = /start="(\d{14} [+-]\d{4})"/g;
    let timeMatch;
    while ((timeMatch = timeFormatRegex.exec(xmltv)) !== null) {
      const timeStr = timeMatch[1];
      if (!/^\d{14} [+-]\d{4}$/.test(timeStr)) {
        errors.push(`Invalid time format: ${timeStr}`);
      }
    }

    // Check for required programme elements
    if (xmltv.includes('<programme') && !xmltv.includes('<title')) {
      warnings.push('Programmes found but missing titles');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Generate a comprehensive validation report
   */
  static async generateValidationReport(): Promise<string> {
    const consistency = await this.validateXmltvConsistency();
    
    let report = "=== XMLTV Validation Report ===\n\n";
    
    report += "DATABASE STATISTICS:\n";
    report += `- Channels in DB: ${consistency.stats.channelsInDb}\n`;
    report += `- Non-stealth channels: ${consistency.stats.channelsInXmltv}\n`;
    report += `- Total programs: ${consistency.stats.programsInDb}\n`;
    report += `- Programs for XMLTV: ${consistency.stats.programsInXmltv}\n\n`;
    
    if (consistency.errors.length > 0) {
      report += "ERRORS (Must Fix):\n";
      consistency.errors.forEach((error, i) => {
        report += `${i + 1}. ${error}\n`;
      });
      report += "\n";
    }
    
    if (consistency.warnings.length > 0) {
      report += "WARNINGS (Should Fix):\n";
      consistency.warnings.forEach((warning, i) => {
        report += `${i + 1}. ${warning}\n`;
      });
      report += "\n";
    }
    
    if (consistency.errors.length === 0 && consistency.warnings.length === 0) {
      report += "✅ All validation checks passed!\n\n";
    }
    
    report += `Overall Status: ${consistency.isValid ? "✅ VALID" : "❌ INVALID"}\n`;
    
    return report;
  }
}

export default XmltvValidator; 