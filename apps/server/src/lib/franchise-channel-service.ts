import { prisma } from './prisma';
import {
  applyFranchiseSortToChannel,
  franchiseSortMethodForSlug,
} from './franchise-sort-service';

/**
 * Tie a channel to a franchise: enable movie automation, TMDB-based matching, timeline sort.
 */
export async function applyFranchiseToChannel(
  channelId: string,
  franchiseId: string,
): Promise<{ channelId: string; franchiseSlug: string; autoSortMethod: string }> {
  const franchise = await prisma.franchise.findUnique({
    where: { id: franchiseId },
    select: { id: true, slug: true },
  });
  if (!franchise) {
    throw new Error('Franchise not found');
  }

  const autoSortMethod = franchiseSortMethodForSlug(franchise.slug);

  await prisma.channel.update({
    where: { id: channelId },
    data: {
      franchiseId: franchise.id,
      autoFilterEnabled: true,
      filterType: 'movies',
      autoSortMethod,
    },
  });

  await applyFranchiseSortToChannel(channelId, franchise.slug);

  return { channelId, franchiseSlug: franchise.slug, autoSortMethod };
}

export async function clearFranchiseFromChannel(channelId: string): Promise<void> {
  await prisma.channel.update({
    where: { id: channelId },
    data: { franchiseId: null },
  });
}
