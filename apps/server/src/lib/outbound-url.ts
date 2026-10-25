import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Outbound URL policy for addresses an admin types in (franchise feeds), same rules as
 * WatchTower's webhook_url_error: http(s) only, and never link-local, cloud metadata,
 * multicast, unspecified or reserved addresses. Private, loopback and tailnet addresses
 * stay allowed because sibling apps live there. Every redirect hop is checked again.
 */
const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // unspecified / "this network"
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, incl. 169.254.169.254 metadata
blocked.addAddress("100.100.100.200", "ipv4"); // Alibaba metadata
blocked.addSubnet("224.0.0.0", 4, "ipv4"); // multicast
blocked.addSubnet("240.0.0.0", 4, "ipv4"); // reserved + broadcast
blocked.addAddress("::", "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addSubnet("ff00::", 8, "ipv6"); // multicast
blocked.addAddress("fd00:ec2::254", "ipv6"); // AWS metadata (IPv6)

export const MAX_REDIRECTS = 5;

function unwrapMapped(ip: string): { address: string; family: "ipv4" | "ipv6" } {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (m) return { address: m[1], family: "ipv4" };
  return { address: ip, family: isIP(ip) === 6 ? "ipv6" : "ipv4" };
}

export function isBlockedAddress(ip: string): boolean {
  const bare = ip.replace(/^\[|\]$/g, "").split("%")[0];
  if (!isIP(bare)) return false;
  const { address, family } = unwrapMapped(bare);
  return blocked.check(address, family);
}

type Lookup = (host: string) => Promise<string[]>;
const systemLookup: Lookup = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Why this URL may not be fetched, or null when it may. */
export async function outboundUrlError(raw: string, resolve: Lookup = systemLookup): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https URLs are allowed";
  if (url.username || url.password) return "URLs with a user name or password are not allowed";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return "URL has no host";
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      return null; // unresolvable: the fetch itself will fail
    }
  }
  const bad = addresses.find(isBlockedAddress);
  return bad ? `address ${bad} is not allowed (link-local, metadata, multicast or reserved)` : null;
}

export class OutboundUrlRefused extends Error {}

/** fetch() that checks the URL, and each redirect hop, against outboundUrlError. */
export async function fetchChecked(
  raw: string,
  init: RequestInit = {},
  deps: { fetch?: typeof fetch; resolve?: Lookup } = {},
): Promise<Response> {
  const doFetch = deps.fetch ?? fetch;
  let current = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refused = await outboundUrlError(current, deps.resolve);
    if (refused) throw new OutboundUrlRefused(`Refused ${new URL(current).origin}: ${refused}`);
    const res = await doFetch(current, { ...init, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => undefined);
    current = new URL(location, current).toString();
  }
  throw new OutboundUrlRefused(`Refused: more than ${MAX_REDIRECTS} redirects`);
}
