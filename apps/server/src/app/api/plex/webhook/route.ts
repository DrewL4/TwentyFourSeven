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
    const payloadEntry = formData.get('payload');
    
    if (!payloadEntry) {
      console.log('❌ No payload in webhook');
      return NextResponse.json({ error: 'No payload' }, { status: 400 });
    }

    // Handle both string and File payloads
    let payload: string;
    if (payloadEntry instanceof File) {
      // If it's a File object, read the text content
      payload = await payloadEntry.text();
      console.log('📄 Received payload as File, extracted text content');
    } else {
      // If it's already a string, use it directly
      payload = payloadEntry as string;
      console.log('📝 Received payload as string');
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
      } else if (webhookData.event === 'library.delete') {
        await handleLibraryDeleteEvent(webhookData);
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
      where: { serverId: plexServer.id, key: metadata.librarySectionID.toString() }
    });
    if (!library) {
      console.log(`⚠️ Library not found for section ID: ${metadata.librarySectionID}`);
      return;
    }
    const { PlexAPI } = await import('@/lib/plex');
    const plex = new PlexAPI({ uri: plexServer.url });
    if (!plexServer.token) {
      console.log('⚠️ No token for Plex server');
      return;
    }
    // Attempt to fetch full metadata for collections, genres, etc.
    let collectionsJson = '[]';
    let genresJson = '[]';
    let directorsJson = '[]';
    let writersJson = '[]';
    let actorsJson = '[]';
    let countriesJson = '[]';
    try {
      const detail = await fetch(`${plexServer.url}/library/metadata/${metadata.ratingKey}`, {
        headers: { 'X-Plex-Token': plexServer.token }
      });
      if (detail.ok) {
        const data = await detail.json();
        const m = data?.MediaContainer?.Metadata?.[0] || {};
        collectionsJson = JSON.stringify((m.Collection || []).map((c: any) => c.tag));
        genresJson = JSON.stringify((m.Genre || []).map((c: any) => c.tag));
        directorsJson = JSON.stringify((m.Director || []).map((c: any) => c.tag));
        writersJson = JSON.stringify((m.Writer || []).map((c: any) => c.tag));
        actorsJson = JSON.stringify((m.Role || []).map((c: any) => c.tag));
        countriesJson = JSON.stringify((m.Country || []).map((c: any) => c.tag));
      }
    } catch {}

    await prisma.mediaMovie.upsert({
      where: { libraryId_ratingKey: { libraryId: library.id, ratingKey: metadata.ratingKey } },
      update: {
        title: metadata.title,
        year: metadata.year,
        summary: metadata.summary,
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        contentRating: metadata.contentRating,
        genres: genresJson,
        directors: directorsJson,
        writers: writersJson,
        actors: actorsJson,
        countries: countriesJson,
        collections: collectionsJson
      },
      create: {
        libraryId: library.id,
        title: metadata.title,
        year: metadata.year || 0,
        summary: metadata.summary,
        duration: 0,
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        ratingKey: metadata.ratingKey,
        contentRating: metadata.contentRating,
        genres: genresJson,
        directors: directorsJson,
        writers: writersJson,
        actors: actorsJson,
        countries: countriesJson,
        collections: collectionsJson
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
    const library = await prisma.mediaLibrary.findFirst({
      where: { serverId: plexServer.id, key: metadata.librarySectionID.toString() }
    });
    if (!library) {
      console.log(`⚠️ Library not found for section ID: ${metadata.librarySectionID}`);
      return;
    }
    const { PlexAPI } = await import('@/lib/plex');
    const plex = new PlexAPI({ uri: plexServer.url });
    if (!plexServer.token) {
      console.log('⚠️ No token for Plex server');
      return;
    }

    let collectionsJson = '[]';
    let genresJson = '[]';
    let directorsJson = '[]';
    let writersJson = '[]';
    let actorsJson = '[]';
    let countriesJson = '[]';
    try {
      const detail = await fetch(`${plexServer.url}/library/metadata/${metadata.ratingKey}`, {
        headers: { 'X-Plex-Token': plexServer.token }
      });
      if (detail.ok) {
        const data = await detail.json();
        const m = data?.MediaContainer?.Metadata?.[0] || {};
        collectionsJson = JSON.stringify((m.Collection || []).map((c: any) => c.tag));
        genresJson = JSON.stringify((m.Genre || []).map((c: any) => c.tag));
        directorsJson = JSON.stringify((m.Director || []).map((c: any) => c.tag));
        writersJson = JSON.stringify((m.Writer || []).map((c: any) => c.tag));
        actorsJson = JSON.stringify((m.Role || []).map((c: any) => c.tag));
        countriesJson = JSON.stringify((m.Country || []).map((c: any) => c.tag));
      }
    } catch {}

    await prisma.mediaShow.upsert({
      where: { libraryId_ratingKey: { libraryId: library.id, ratingKey: metadata.ratingKey } },
      update: {
        title: metadata.title,
        year: metadata.year,
        summary: metadata.summary,
        poster: metadata.thumb && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.thumb) : null,
        backdrop: metadata.art && plexServer.token ? plex.getThumbnailUrl(plexServer.url, plexServer.token, metadata.art) : null,
        contentRating: metadata.contentRating,
        genres: genresJson,
        directors: directorsJson,
        writers: writersJson,
        actors: actorsJson,
        countries: countriesJson,
        collections: collectionsJson
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
        genres: genresJson,
        directors: directorsJson,
        writers: writersJson,
        actors: actorsJson,
        countries: countriesJson,
        collections: collectionsJson
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

async function handleLibraryDeleteEvent(webhookData: PlexWebhookPayload) {
  try {
    const { Metadata, Server } = webhookData;

    // Find the matching Plex server in our database
    const plexServer = await prisma.mediaServer.findFirst({
      where: {
        type: 'PLEX',
        OR: [
          { name: Server.title },
        ]
      }
    });

    if (!plexServer) {
      console.log(`⚠️ Webhook from unknown Plex server: ${Server.title}`);
      return;
    }

    console.log(`🗑️ Processing library.delete for ${Metadata.title} (${Metadata.type}) on server ${Server.title}`);

    // Identify corresponding library (only needed for movie/show deletes)
    let library: any = null;
    if (Metadata.librarySectionID) {
      library = await prisma.mediaLibrary.findFirst({
        where: {
          serverId: plexServer.id,
          key: Metadata.librarySectionID.toString()
        }
      });
    }

    // Delete based on content type
    if (Metadata.librarySectionType === 'movie' && Metadata.type === 'movie') {
      if (!library) return;
      await prisma.mediaMovie.deleteMany({
        where: {
          libraryId: library.id,
          ratingKey: Metadata.ratingKey
        }
      });
      console.log(`✅ Movie removed: ${Metadata.title}`);
    } else if (Metadata.librarySectionType === 'show') {
      if (Metadata.type === 'show') {
        if (!library) return;
        await prisma.mediaShow.deleteMany({
          where: {
            libraryId: library.id,
            ratingKey: Metadata.ratingKey
          }
        });
        console.log(`✅ Show removed: ${Metadata.title}`);
      } else if (Metadata.type === 'episode') {
        // Episode deletion – need parent show first
        const parentShow = await prisma.mediaShow.findFirst({
          where: {
            ratingKey: Metadata.grandparentRatingKey
          }
        });
        if (parentShow) {
          await prisma.mediaEpisode.deleteMany({
            where: {
              showId: parentShow.id,
              ratingKey: Metadata.ratingKey
            }
          });
          console.log(`✅ Episode removed: ${Metadata.grandparentTitle} - ${Metadata.title}`);
        }
      }
    }

    // Trigger channel automation after deletion
    try {
      const { channelAutomationService } = await import('@/lib/channel-automation-service');
      await channelAutomationService.processAutomatedChannels();
    } catch (err) {
      console.error('Failed to run channel automation after deletion:', err);
    }

    // Run programming maintenance to fill any gaps caused by deletion
    try {
      const { programmingService } = await import('@/lib/programming-service');
      await programmingService.maintainPrograms();
    } catch (err) {
      console.error('Failed to run programming maintenance after deletion:', err);
    }
  } catch (error) {
    console.error('❌ Error handling library.delete event:', error);
  }
} 