import { syncFranchise } from '../src/lib/franchise-sync-service';
import { applyFranchiseSortToChannel } from '../src/lib/franchise-sort-service';
import { channelAutomationService } from '../src/lib/channel-automation-service';
import { prisma } from '../src/lib/prisma';

async function main() {
  const slug = 'star-wars-collection';
  const franchise = await prisma.franchise.findUnique({ where: { slug } });
  if (!franchise) {
    console.error('Franchise not found:', slug);
    process.exit(1);
  }

  const channel = await prisma.channel.findFirst({
    where: { franchiseId: franchise.id },
    select: { id: true, name: true },
  });

  const sync = await syncFranchise(slug);
  console.log('sync', sync);

  if (channel) {
    await channelAutomationService.processChannelById(channel.id);
    const sort = await applyFranchiseSortToChannel(channel.id, slug);
    console.log('channel sort', sort);
  }

  const entries = await prisma.franchiseEntry.findMany({
    where: { franchiseId: franchise.id },
    orderBy: { position: 'asc' },
    select: { position: true, label: true, movieId: true },
  });
  console.log('\nFranchise order:');
  for (const e of entries) {
    console.log(`  ${e.position + 1}. ${e.label}${e.movieId ? ' [linked]' : ''}`);
  }

  if (channel) {
    const lineup = await prisma.channelMovie.findMany({
      where: { channelId: channel.id },
      orderBy: { order: 'asc' },
      include: { movie: { select: { title: true } } },
    });
    console.log(`\nChannel "${channel.name}" lineup:`);
    for (const cm of lineup) {
      console.log(`  ${cm.order + 1}. ${cm.movie.title}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
