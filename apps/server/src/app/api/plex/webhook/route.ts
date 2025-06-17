import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface PlexWebhookPayload {
  event: string;
  user: boolean;
  owner: boolean;
  Account: {
    id: number;
    thumb: string;
    title: string;
  };
  Server: {
    title: string;
    uuid: string;
  };
  Player: {
    local: boolean;
    publicAddress: string;
    title: string;
    uuid: string;
  };
  Metadata: {
    librarySectionType: string;
    ratingKey: string;
    key: string;
    parentRatingKey?: string;
    grandparentRatingKey?: string;
    guid: string;
    librarySectionID: number;
    type: string;
    title: string;
    grandparentKey?: string;
    parentKey?: string;
    grandparentTitle?: string;
    parentTitle?: string;
    contentRating?: string;
    summary?: string;
    rating?: number;
    audienceRating?: number;
    year?: number;
    thumb?: string;
    art?: string;
    parentThumb?: string;
    grandparentThumb?: string;
    grandparentArt?: string;
    addedAt?: number;
    updatedAt?: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    console.log('📡 Received Plex webhook');
    
    // Check if webhooks are enabled
    const plexSettings = await prisma.plexSettings.findUnique({
      where: { id: "singleton" }
    });
    
    if (!plexSettings?.webhookEnabled) {
      console.log('⚠️ Plex webhooks are disabled, ignoring request');
      return NextResponse.json({ message: 'Webhooks disabled' }, { status: 200 });
    }
    
    // Parse the multipart form data that Plex sends
    const formData = await request.formData();
    const payload = formData.get('payload') as string;
    
    if (!payload) {
      console.log('❌ No payload in webhook');
      return NextResponse.json({ error: 'No payload' }, { status: 400 });
    }

    const webhookData: PlexWebhookPayload = JSON.parse(payload);
    console.log(`📺 Plex webhook event: ${webhookData.event} for ${webhookData.Metadata?.title || 'unknown'}`);

    // Log webhook activity
    const webhookActivity = await prisma.webhookActivity.create({
      data: {
        source: 'plex',
        serverName: webhookData.Server?.title || 'Unknown Server',
        eventType: webhookData.event,
        contentType: webhookData.Metadata?.type || 'unknown',
        contentTitle: webhookData.Metadata?.title || 'Unknown',
        contentId: webhookData.Metadata?.ratingKey,
        payload: payload,
        status: 'pending'
      }
    });

    try {
      // Handle library content addition/update events
      if (webhookData.event === 'library.new' || webhookData.event === 'library.update') {
        await handleLibraryEvent(webhookData);
      }

      // Update webhook activity status to processed
      await prisma.webhookActivity.update({
        where: { id: webhookActivity.id },
        data: { status: 'processed' }
      });

      return NextResponse.json({ success: true });
    } catch (processingError) {
      // Update webhook activity status to failed
      await prisma.webhookActivity.update({
        where: { id: webhookActivity.id },
        data: { 
          status: 'failed',
          errorMessage: processingError instanceof Error ? processingError.message : 'Unknown error'
        }
      });
      throw processingError;
    }
  } catch (error) {
    console.error('❌ Error processing Plex webhook:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handleLibraryEvent(webhookData: PlexWebhookPayload) {
  try {
    const { Metadata, Server } = webhookData;
    
    // Find the matching Plex server in our database
    const plexServer = await prisma.mediaServer.findFirst({
      where: {
        type: 'PLEX',
        // Match by server UUID or name - adjust based on your setup
        OR: [
          { name: Server.title },
          // You might need to store server UUID in the database for better matching
        ]
      }
    });

    if (!plexServer) {
      console.log(`⚠️ Webhook from unknown Plex server: ${Server.title}`);
      return;
    }

    console.log(`🔄 Processing ${webhookData.event} for ${Metadata.title} on server ${Server.title}`);

    // Trigger selective sync based on content type
    if (Metadata.librarySectionType === 'movie' && Metadata.type === 'movie') {
      await syncSingleMovie(plexServer, Metadata);
    } else if (Metadata.librarySectionType === 'show') {
      if (Metadata.type === 'show') {
        await syncSingleShow(plexServer, Metadata);
      } else if (Metadata.type === 'episode') {
        await syncSingleEpisode(plexServer, Metadata);
      }
    }

    // Trigger channel automation after webhook processing
    const { channelAutomationService } = await import('@/lib/channel-automation-service');
    await channelAutomationService.processAutomatedChannels();
    console.log('✅ Channel automation processed after webhook');

  } catch (error) {
    console.error('❌ Error handling library event:', error);
  }
}

async function syncSingleMovie(plexServer: any, metadata: any) {
  try {
    console.log(`🎬 Syncing movie: ${metadata.title}`);
    
    // Find the library this movie belongs to
    const library = await prisma.mediaLibrary.findFirst({
      where: {
        serverId: plexServer.id,
        key: metadata.librarySectionID.toString()
      }
    });

    if (!library) {
      console.log(`⚠️ Library not found for section ID: ${metadata.librarySectionID}`);
      return;
    }

    // Import Plex service and sync this specific movie
    const { PlexAPI } = await import('@/lib/plex');
    const plex = new PlexAPI({ uri: plexServer.url });
    
    if (!plexServer.token) {
      console.log('⚠️ No token for Plex server');
      return;
    }

    // Use webhook metadata (simplified sync for real-time updates)
    await prisma.mediaMovie.upsert({
      where: {
        libraryId_ratingKey: {
          libraryId: library.id,
          ratingKey: metadata.ratingKey
        }
      },
      update: {
        title: metadata.title,
        year: metadata.year,
        summary: metadata.summary,
        // Basic fields from webhook - full sync will happen on next scheduled sync
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        contentRating: metadata.contentRating
      },
      create: {
        libraryId: library.id,
        title: metadata.title,
        year: metadata.year || 0,
        summary: metadata.summary,
        duration: 0, // Will be updated on full sync
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        ratingKey: metadata.ratingKey,
        contentRating: metadata.contentRating,
        // Basic empty metadata - will be updated on full sync
        genres: '[]',
        directors: '[]',
        writers: '[]',
        actors: '[]',
        countries: '[]'
      }
    });

    console.log(`✅ Movie synced: ${metadata.title}`);
  } catch (error) {
    console.error(`❌ Error syncing movie ${metadata.title}:`, error);
  }
}

async function syncSingleShow(plexServer: any, metadata: any) {
  try {
    console.log(`📺 Syncing show: ${metadata.title}`);
    
    // Find the library this show belongs to
    const library = await prisma.mediaLibrary.findFirst({
      where: {
        serverId: plexServer.id,
        key: metadata.librarySectionID.toString()
      }
    });

    if (!library) {
      console.log(`⚠️ Library not found for section ID: ${metadata.librarySectionID}`);
      return;
    }

    // Import Plex service and sync this specific show
    const { PlexAPI } = await import('@/lib/plex');
    const plex = new PlexAPI({ uri: plexServer.url });
    
    if (!plexServer.token) {
      console.log('⚠️ No token for Plex server');
      return;
    }

    // Use webhook metadata (simplified sync for real-time updates)
    await prisma.mediaShow.upsert({
      where: {
        libraryId_ratingKey: {
          libraryId: library.id,
          ratingKey: metadata.ratingKey
        }
      },
      update: {
        title: metadata.title,
        year: metadata.year,
        summary: metadata.summary,
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        contentRating: metadata.contentRating
      },
      create: {
        libraryId: library.id,
        title: metadata.title,
        year: metadata.year || 0,
        summary: metadata.summary,
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        ratingKey: metadata.ratingKey,
        contentRating: metadata.contentRating,
        // Basic empty metadata - will be updated on full sync
        genres: '[]',
        directors: '[]',
        writers: '[]',
        actors: '[]',
        countries: '[]'
      }
    });

    console.log(`✅ Show synced: ${metadata.title}`);
  } catch (error) {
    console.error(`❌ Error syncing show ${metadata.title}:`, error);
  }
}

async function syncSingleEpisode(plexServer: any, metadata: any) {
  try {
    console.log(`📺 Syncing episode: ${metadata.grandparentTitle} - ${metadata.title}`);
    
    // First, find the parent show
    const show = await prisma.mediaShow.findFirst({
      where: {
        ratingKey: metadata.grandparentRatingKey,
        library: {
          serverId: plexServer.id
        }
      }
    });

    if (!show) {
      console.log(`⚠️ Parent show not found for episode: ${metadata.title}`);
      return;
    }

    // Import Plex service and sync this specific episode
    const { PlexAPI } = await import('@/lib/plex');
    const plex = new PlexAPI({ uri: plexServer.url });
    
    if (!plexServer.token) {
      console.log('⚠️ No token for Plex server');
      return;
    }

    // Use webhook metadata (simplified sync for real-time updates)
    await prisma.mediaEpisode.upsert({
      where: {
        showId_ratingKey: {
          showId: show.id,
          ratingKey: metadata.ratingKey
        }
      },
      update: {
        title: metadata.title,
        summary: metadata.summary,
        duration: 0, // Will be updated on full sync
        seasonNumber: metadata.parentIndex || 1,
        episodeNumber: metadata.index || 1,
        thumb: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null
      },
      create: {
        showId: show.id,
        title: metadata.title,
        summary: metadata.summary,
        duration: 0, // Will be updated on full sync
        seasonNumber: metadata.parentIndex || 1,
        episodeNumber: metadata.index || 1,
        thumb: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        ratingKey: metadata.ratingKey
      }
    });

    console.log(`✅ Episode synced: ${metadata.grandparentTitle} - ${metadata.title}`);
  } catch (error) {
    console.error(`❌ Error syncing episode ${metadata.title}:`, error);
  }
} 