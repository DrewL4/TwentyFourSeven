import { test } from "node:test";
import assert from "node:assert/strict";
import { decidePlexImageAccess } from "./plex-image-access";
import {
  createPlayerImageLinker,
  normalizePlexImageTarget,
  parsePlexImageReference,
  signPlexImageTarget,
} from "./plex-image";

const TOKEN = "fake-token-for-tests";
const ORIGIN = "http://plex.lab.test:32400";
const servers = [{ url: `${ORIGIN}/`, token: TOKEN }];
const signedIn = async () => true;
const signedOut = async () => false;

function params(obj: Record<string, string>) {
  return new URLSearchParams(obj);
}

test("artwork paths are allowed, anything else is not", () => {
  assert.deepEqual(normalizePlexImageTarget(ORIGIN, "/library/metadata/16/thumb/1792679297"), {
    origin: ORIGIN,
    path: "/library/metadata/16/thumb/1792679297",
  });
  assert.ok(normalizePlexImageTarget(ORIGIN, "/library/metadata/1/art/1"));
  assert.ok(normalizePlexImageTarget(ORIGIN, "/library/collections/9/composite/123"));
  for (const bad of [
    "/library/sections",
    "/library/metadata/1",
    "/library/metadata/1/children",
    "/library/metadata/1/thumb/../../../../identity",
    "/library/metadata/1/thumb/%2e%2e/%2e%2e/%2e%2e/accounts",
    "/:/prefs",
    "/identity",
    "//evil.test/library/metadata/1/thumb",
    "library/metadata/1/thumb",
  ]) {
    assert.equal(normalizePlexImageTarget(ORIGIN, bad), null, bad);
  }
});

test("transcode is allowed only for this server's own artwork, with known params", () => {
  const ok = normalizePlexImageTarget(
    ORIGIN,
    "/photo/:/transcode?width=300&height=450&url=%2Flibrary%2Fmetadata%2F5%2Fthumb%2F1&X-Plex-Token=leak&junk=1",
  );
  assert.ok(ok);
  assert.ok(!ok.path.includes("X-Plex-Token"));
  assert.ok(!ok.path.includes("junk"));
  assert.ok(ok.path.startsWith("/photo/:/transcode?"));
  assert.equal(normalizePlexImageTarget(ORIGIN, "/photo/:/transcode?url=http%3A%2F%2Fevil.test%2Fa.jpg"), null);
  assert.equal(normalizePlexImageTarget(ORIGIN, "/photo/:/transcode?url=%2F%2Fevil.test%2Flibrary%2Fmetadata%2F1%2Fthumb"), null);
  assert.equal(normalizePlexImageTarget(ORIGIN, "/photo/:/transcode?url=%2Fidentity"), null);
  assert.equal(normalizePlexImageTarget(ORIGIN, "/photo/:/transcode"), null);
});

test("signed out, no signature: refused with 401", async () => {
  const d = await decidePlexImageAccess({
    searchParams: params({ origin: ORIGIN, path: "/library/metadata/1/thumb/1" }),
    servers,
    hasSession: signedOut,
  });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.status, 401);
});

test("signed out, any path or bad parameters: still 401 (nothing else revealed)", async () => {
  for (const sp of [params({ origin: ORIGIN, path: "/identity" }), params({}), params({ url: "http://evil.test/x" })]) {
    const d = await decidePlexImageAccess({ searchParams: sp, servers, hasSession: signedOut });
    assert.equal(!d.ok && d.status, 401);
  }
});

test("signed in: artwork allowed, other paths 400, unknown origin 404", async () => {
  const ok = await decidePlexImageAccess({
    searchParams: params({ origin: ORIGIN, path: "/library/metadata/1/thumb/1?X-Plex-Token=x" }),
    servers,
    hasSession: signedIn,
  });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.via, "session");
  assert.equal(ok.ok && ok.upstreamUrl, `${ORIGIN}/library/metadata/1/thumb/1`);

  const badPath = await decidePlexImageAccess({
    searchParams: params({ origin: ORIGIN, path: "/library/sections/1/all" }),
    servers,
    hasSession: signedIn,
  });
  assert.equal(!badPath.ok && badPath.status, 400);

  // Host contained in the configured URL is not enough: origins must match exactly.
  const lookalike = await decidePlexImageAccess({
    searchParams: params({ origin: "http://lab.test:32400", path: "/library/metadata/1/thumb/1" }),
    servers,
    hasSession: signedIn,
  });
  assert.equal(!lookalike.ok && lookalike.status, 404);
});

test("valid signature works without a session; a wrong or reused one does not", async () => {
  const target = normalizePlexImageTarget(ORIGIN, "/library/metadata/7/thumb/1")!;
  const sig = signPlexImageTarget(target, TOKEN);
  const good = await decidePlexImageAccess({
    searchParams: params({ origin: ORIGIN, path: target.path, sig }),
    servers,
    hasSession: signedOut,
  });
  assert.ok(good.ok);
  assert.equal(good.ok && good.via, "signature");

  const otherPath = await decidePlexImageAccess({
    searchParams: params({ origin: ORIGIN, path: "/library/metadata/8/thumb/1", sig }),
    servers,
    hasSession: signedOut,
  });
  assert.equal(!otherPath.ok && otherPath.status, 401);

  const forged = await decidePlexImageAccess({
    searchParams: params({ origin: ORIGIN, path: target.path, sig: "x".repeat(sig.length) }),
    servers,
    hasSession: signedOut,
  });
  assert.equal(!forged.ok && forged.status, 401);
});

test("player links are signed, carry no token, and pass the access check", async () => {
  const link = createPlayerImageLinker(servers);
  const out = link(`${ORIGIN}/library/metadata/16/thumb/1792679297?X-Plex-Token=${TOKEN}`, "https://tv.example");
  assert.ok(out.startsWith("https://tv.example/images/plex?"));
  assert.ok(!out.includes(TOKEN));
  assert.ok(!/X-Plex-Token/i.test(out));
  const sp = new URL(out).searchParams;
  assert.ok(sp.get("sig"));
  const d = await decidePlexImageAccess({ searchParams: sp, servers, hasSession: signedOut });
  assert.ok(d.ok);

  // Stored relative /images/plex links (cached collection icons) get signed too.
  const relative = link("/images/plex?origin=" + encodeURIComponent(ORIGIN) + "&path=%2Flibrary%2Fcollections%2F3%2Fcomposite%2F9", "@@BASE@@");
  assert.ok(relative.startsWith("@@BASE@@/images/plex?"));
  assert.ok(relative.includes("sig="));

  // Non-Plex icons pass through unchanged.
  assert.equal(link("https://cdn.example/logo.png", "https://tv.example"), "https://cdn.example/logo.png");
});

test("parsePlexImageReference reads direct URLs and proxy links", () => {
  assert.deepEqual(parsePlexImageReference(`${ORIGIN}/library/metadata/2/art/5?X-Plex-Token=abc`), {
    origin: ORIGIN,
    path: "/library/metadata/2/art/5",
  });
  assert.equal(parsePlexImageReference("/placeholder.svg"), null);
  assert.equal(parsePlexImageReference("not a url"), null);
});

test("with an image pass, links carry t= (no sig, no token); old sig links can be turned off", async () => {
  const link = createPlayerImageLinker(servers, { pass: "@@PASS@@" });
  const out = link(`${ORIGIN}/library/metadata/16/thumb/1?X-Plex-Token=${TOKEN}`, "https://tv.example");
  const sp = new URL(out).searchParams;
  assert.equal(sp.get("t"), "@@PASS@@");
  assert.equal(sp.get("sig"), null);
  assert.ok(!out.includes(TOKEN));

  // Local artwork uses an opaque id, never a file path.
  assert.equal(link("/images/local/abc123/poster", "https://tv.example"), "https://tv.example/images/local/abc123/poster?t=@@PASS@@");

  const target = normalizePlexImageTarget(ORIGIN, "/library/metadata/7/thumb/1")!;
  const legacy = params({ origin: ORIGIN, path: target.path, sig: signPlexImageTarget(target, TOKEN) });
  const refused = await decidePlexImageAccess({ searchParams: legacy, servers, hasSession: signedOut, acceptSignature: false });
  assert.equal(refused.ok, false);
});
