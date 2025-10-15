const { PrismaClient } = require('./apps/server/prisma/generated');
const prisma = new PrismaClient();

async function testAutomation() {
  try {
    console.log('🧪 Testing Channel Automation System');

    // Check existing channels
    const channels = await prisma.channel.findMany({
      select: {
        id: true,
        name: true,
        autoFilterEnabled: true,
        filterCollections: true,
        filterGenres: true,
        channelMovies: { select: { id: true } },
        channelShows: { select: { id: true } }
      }
    });

    console.log(`📺 Found ${channels.length} channels`);
    channels.forEach(ch => {
      console.log(`  - ${ch.name}: auto=${ch.autoFilterEnabled}, collections=${ch.filterCollections}, movies=${ch.channelMovies.length}, shows=${ch.channelShows.length}`);
    });

    // Check existing movies
    const movies = await prisma.mediaMovie.findMany({
      take: 5,
      select: {
        id: true,
        title: true,
        collections: true,
        genres: true
      }
    });

    console.log(`🎬 Found ${movies.length} movies in database`);
    movies.forEach(m => {
      console.log(`  - ${m.title}: collections=${m.collections}, genres=${m.genres}`);
    });

    // Check existing shows
    const shows = await prisma.mediaShow.findMany({
      take: 5,
      select: {
        id: true,
        title: true,
        collections: true,
        genres: true
      }
    });

    console.log(`📺 Found ${shows.length} shows in database`);
    shows.forEach(s => {
      console.log(`  - ${s.title}: collections=${s.collections}, genres=${s.genres}`);
    });

    // Test automation service (import it)
    console.log('🔧 Testing automation service import...');
    const { channelAutomationService } = require('./apps/server/src/lib/channel-automation-service.ts');
    console.log('✅ Automation service imported successfully');

    console.log('🎯 Automation service methods:', Object.getOwnPropertyNames(channelAutomationService.__proto__).filter(m => typeof channelAutomationService[m] === 'function'));

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testAutomation();
