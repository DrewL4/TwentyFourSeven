import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSessionCookie, homeNetworkFallback } from "./home-network-fallback";
import { viewerFromAuth } from "./viewer-limit";

const base = { hasCredential: false, allowLan: true, privateAddress: true, lanWithoutKey: true, session: "none" as const };

test("a home-network device with no cookie still plays without a key (and has no per-person limit)", () => {
  assert.equal(homeNetworkFallback(base), "lan");
  assert.equal(viewerFromAuth({ via: "lan", userId: null }), null);
});

test("regression: a browser whose sign-in cookie no longer resolves is not waved through as anonymous LAN", () => {
  // Before: an expired/invalid session fell through to the home-network pass,
  // which carries no viewer, so that person's 24/7 stream limit vanished.
  assert.equal(homeNetworkFallback({ ...base, session: "dead" }), "session-expired");
  assert.equal(homeNetworkFallback({ ...base, session: "error" }), "session-unavailable");
});

test("no home-network pass off the LAN, with LAN keyless off, for xtream/live paths, or when a credential was offered", () => {
  assert.equal(homeNetworkFallback({ ...base, privateAddress: false }), "deny");
  assert.equal(homeNetworkFallback({ ...base, lanWithoutKey: false }), "deny");
  assert.equal(homeNetworkFallback({ ...base, allowLan: false }), "deny");
  assert.equal(homeNetworkFallback({ ...base, hasCredential: true }), "deny");
  assert.equal(homeNetworkFallback({ ...base, privateAddress: false, session: "dead" }), "deny");
});

test("player keys (k=) still skip the per-person limit (unchanged rule)", () => {
  assert.equal(viewerFromAuth({ via: "key", userId: null }), null);
  assert.ok(viewerFromAuth({ via: "session", userId: "u1", email: "a@example.test" }));
});

test("session cookie detection", () => {
  assert.equal(hasSessionCookie("better-auth.session_token=abc.def"), true);
  assert.equal(hasSessionCookie("theme=dark; __Secure-better-auth.session_token=abc"), true);
  assert.equal(hasSessionCookie("better-auth.session_data=abc; theme=dark"), false);
  assert.equal(hasSessionCookie("better-auth.session_token="), false);
  assert.equal(hasSessionCookie(null), false);
});
