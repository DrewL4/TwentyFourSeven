import { test } from "node:test";
import assert from "node:assert/strict";
import { channelIconsForGuide } from "./xmltv-channel-icons";
import { createPlayerImageLinker, parsePlexImageReference } from "./plex-image";
import { toPlaceholderIconUrl, XMLTV_BASE_URL_PLACEHOLDER, XMLTV_IMAGE_PASS_PLACEHOLDER, XMLTV_SCHEME_PLACEHOLDER } from "./xmltv-static-cache";

type Ch = { id: string; icon: string | null; cachedCollectionIcon: string | null };
type Pr = { channelId: string; episode: { show?: { poster: string | null } | null } | null; movie: { poster: string | null } | null };

// The loop as it stood in media.xml/route.ts before the change, kept verbatim for comparison.
function oldIcons(channels: Ch[], programs: Pr[], toPlexProxy: (b: string, u: string) => string, baseUrl: string) {
  const isAbsolute = (url?: string | null) =>
    !!url && (/^(https?:)?\/\//i.test(url) || url.startsWith("/images/local/"));
  const channelIconMap = new Map<string, string>();
  for (const channel of channels) {
    if (isAbsolute(channel.icon)) {
      try {
        const u = new URL(channel.icon as string);
        channelIconMap.set(channel.id, toPlexProxy(baseUrl, u.toString()));
        continue;
      } catch {}
    }
    if (channel.cachedCollectionIcon) {
      channelIconMap.set(channel.id, parsePlexImageReference(channel.cachedCollectionIcon)
        ? toPlexProxy(baseUrl, channel.cachedCollectionIcon)
        : toPlaceholderIconUrl(channel.cachedCollectionIcon));
      continue;
    }
    if (isAbsolute(channel.icon)) {
      try {
        const u = new URL(channel.icon as string);
        channelIconMap.set(channel.id, toPlexProxy(baseUrl, u.toString()));
        continue;
      } catch {}
    }
    const program = programs.find(p => p.channelId === channel.id);
    const poster = program?.episode?.show?.poster || program?.movie?.poster || null;
    if (isAbsolute(poster)) channelIconMap.set(channel.id, toPlexProxy(baseUrl, poster as string));
  }
  return channelIconMap;
}

const ICONS = [null, "", "https://cdn.example.test/logo.png", "http://plex.example.test:32400/library/metadata/1/thumb/2?X-Plex-Token=abc",
  "//cdn.example.test/proto-relative.png", "/images/local/abc.jpg", "relative/logo.png", "https://", "HTTP://UPPER.example.test/a.png"];
const COLLECTION = [null, "", "http://plex.example.test:32400/library/collections/9/thumb/1", "/images/icons/c.png", "https://other.example.test/c.png"];
const POSTERS = [null, "", "http://plex.example.test:32400/library/metadata/5/thumb/1", "/images/local/p.jpg", "posters/rel.jpg", "//cdn.example.test/p.jpg"];

function rng(seed: number) { return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

test("channel icons match the previous loop except for local and protocol-relative icons", () => {
  const linker = createPlayerImageLinker([{ url: "http://plex.example.test:32400", token: "t" }], { pass: XMLTV_IMAGE_PASS_PLACEHOLDER });
  const base = XMLTV_BASE_URL_PLACEHOLDER;
  const r = rng(7);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  for (let round = 0; round < 50; round++) {
    const channels: Ch[] = [];
    let i = 0;
    for (const icon of ICONS) for (const cachedCollectionIcon of COLLECTION) channels.push({ id: `c${round}-${i++}`, icon, cachedCollectionIcon });
    const programs: Pr[] = [];
    for (const ch of channels) {
      const n = Math.floor(r() * 4); // some channels have no programmes
      for (let k = 0; k < n; k++) {
        const kind = r();
        programs.push({
          channelId: ch.id,
          episode: kind < 0.4 ? { show: r() < 0.9 ? { poster: pick(POSTERS) } : null } : null,
          movie: kind >= 0.4 && kind < 0.9 ? { poster: pick(POSTERS) } : null,
        });
      }
    }
    const before = oldIcons(channels, programs, (b, u) => linker(u, b), base);
    const after = channelIconsForGuide(channels, programs, (u) => linker(u, base), XMLTV_SCHEME_PLACEHOLDER);
    const fixed = (c: Ch) => !!c.icon && (c.icon.startsWith("/images/local/") || c.icon.startsWith("//"));
    const unchanged = channels.filter((c) => !fixed(c)).map((c) => c.id);
    assert.deepEqual(unchanged.map((id) => after.get(id)), unchanged.map((id) => before.get(id)));
    for (const c of channels.filter(fixed)) {
      const want = c.icon!.startsWith("//")
        ? `${XMLTV_SCHEME_PLACEHOLDER}:${c.icon}`
        : `${base}${c.icon}?t=${XMLTV_IMAGE_PASS_PLACEHOLDER}`;
      assert.equal(after.get(c.id), want, `icon ${c.icon} wins over collection art and posters`);
    }
  }
});

test("the fallback takes the first programme of each channel, not a later one", () => {
  const icons = channelIconsForGuide(
    [{ id: "a", icon: null, cachedCollectionIcon: null }],
    [
      { channelId: "a", episode: null, movie: { poster: "https://cdn.example.test/first.jpg" } },
      { channelId: "a", episode: null, movie: { poster: "https://cdn.example.test/second.jpg" } },
    ],
    (u) => u,
    "https",
  );
  assert.equal(icons.get("a"), "https://cdn.example.test/first.jpg");
});
