import type { QueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";
import { CHANNEL_DETAIL_OPTIONS } from "@/utils/query-options";

export function channelLineupQueryOptions(channelId: string) {
  return {
    ...orpc.channels.getLineup.queryOptions({ input: { id: channelId } }),
    ...CHANNEL_DETAIL_OPTIONS,
  };
}

export function channelShowEpisodesQueryOptions(
  channelId: string,
  showId: string,
) {
  return {
    ...orpc.channels.getShowEpisodes.queryOptions({
      input: { channelId, showId },
    }),
    ...CHANNEL_DETAIL_OPTIONS,
  };
}

export function prefetchChannelLineup(
  queryClient: QueryClient,
  channelId: string,
) {
  return queryClient.prefetchQuery(channelLineupQueryOptions(channelId));
}

export function invalidateChannelLineup(
  queryClient: QueryClient,
  channelId: string,
) {
  return queryClient.invalidateQueries({
    queryKey: orpc.channels.getLineup.queryOptions({ input: { id: channelId } })
      .queryKey,
  });
}

/** Invalidate lineup + legacy get (Add Content dialog / mutations). */
export function invalidateChannelDetail(
  queryClient: QueryClient,
  channelId: string,
) {
  return Promise.all([
    invalidateChannelLineup(queryClient, channelId),
    queryClient.invalidateQueries({
      queryKey: orpc.channels.get.queryOptions({ input: { id: channelId } })
        .queryKey,
    }),
  ]);
}
