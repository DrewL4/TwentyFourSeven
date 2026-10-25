import { parsePlexImageReference } from "./plex-image";
import { toPlaceholderIconUrl } from "./xmltv-static-cache";

/** Absolute or protocol-relative URLs, plus locally stored artwork. */
export const isAbsoluteImageUrl = (url?: string | null): boolean =>
  !!url && (/^(https?:)?\/\//i.test(url) || url.startsWith("/images/local/"));

type IconChannel = { id: string; icon: string | null; cachedCollectionIcon: string | null };
type IconProgram = {
  channelId: string;
  episode: { show?: { poster: string | null } | null } | null;
  movie: { poster: string | null } | null;
};

/**
 * Picks each channel's guide icon: its own icon, then cached collection artwork, then the poster
 * of its first programme. `programs` must be ordered by start time within each channel.
 */
export function channelIconsForGuide(
  channels: IconChannel[],
  programs: IconProgram[],
  link: (url: string) => string,
): Map<string, string> {
  const firstProgramByChannel = new Map<string, IconProgram>();
  for (const p of programs) {
    if (!firstProgramByChannel.has(p.channelId)) firstProgramByChannel.set(p.channelId, p);
  }

  const icons = new Map<string, string>();
  for (const channel of channels) {
    if (isAbsoluteImageUrl(channel.icon)) {
      try {
        icons.set(channel.id, link(new URL(channel.icon as string).toString()));
        continue;
      } catch {}
    }

    if (channel.cachedCollectionIcon) {
      icons.set(
        channel.id,
        parsePlexImageReference(channel.cachedCollectionIcon)
          ? link(channel.cachedCollectionIcon)
          : toPlaceholderIconUrl(channel.cachedCollectionIcon),
      );
      continue;
    }

    const program = firstProgramByChannel.get(channel.id);
    const poster = program?.episode?.show?.poster || program?.movie?.poster || null;
    if (isAbsoluteImageUrl(poster)) icons.set(channel.id, link(poster as string));
  }
  return icons;
}
