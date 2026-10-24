import { test } from "node:test";
import assert from "node:assert/strict";

import {
  countViewerStreams,
  linkedLimit,
  shouldRefuseViewer,
  standaloneLimit,
  streamsAllowed,
  viewerFromAuth,
  viewerKey,
  viewerLimitMessage,
} from "./viewer-limit";

test("John: services with 3 and 4 connections, all 7 TV playing -> one 24/7", () => {
  assert.equal(streamsAllowed(3 + 4, 7), 1);
});

test("John: 5 TV playing -> three 24/7", () => {
  assert.equal(streamsAllowed(3 + 4, 5), 3);
});

test("John: nothing playing -> 8 in total, all usable by 24/7", () => {
  assert.equal(streamsAllowed(7, 0), 8);
});

test("no TV service -> one 24/7 stream", () => {
  assert.equal(streamsAllowed(0, 0), 1);
  assert.equal(linkedLimit({ tvConnections: 0, tvActive: 0 }).allowed, 1);
});

test("the extra slot is 24/7-only: never below 1, TV over-use doesn't take it", () => {
  assert.equal(streamsAllowed(2, 9), 1);
  assert.equal(streamsAllowed(NaN, NaN), 1);
});

test("refuses at the limit, allows below it", () => {
  const limit = linkedLimit({ tvConnections: 7, tvActive: 5 }); // 3
  assert.equal(shouldRefuseViewer(2, limit), false);
  assert.equal(shouldRefuseViewer(3, limit), true);
  assert.equal(shouldRefuseViewer(99, null), false);
});

test("ESPG unreachable -> just the one 24/7-only stream", () => {
  const limit = linkedLimit(null);
  assert.equal(limit.allowed, 1);
  assert.match(limit.how, /couldn't be asked/);
});

test("on its own: default 2, admin value wins, 0 blocks", () => {
  assert.equal(standaloneLimit(undefined).allowed, 2);
  assert.equal(standaloneLimit(null).allowed, 2);
  assert.equal(standaloneLimit(5).allowed, 5);
  assert.equal(standaloneLimit(0).allowed, 0);
  assert.equal(shouldRefuseViewer(0, standaloneLimit(0)), true);
});

test("who is watching", () => {
  assert.deepEqual(viewerFromAuth({ via: "token", userId: null, sub: "espg:John@Example.test" }), { email: "john@example.test", userId: null });
  assert.deepEqual(viewerFromAuth({ via: "token", userId: "u1", sub: "user:u1" }), { email: null, userId: "u1" });
  assert.deepEqual(viewerFromAuth({ via: "login", userId: "u1", email: "J@x.test" }), { email: "j@x.test", userId: "u1" });
  assert.deepEqual(viewerFromAuth({ via: "session", userId: "u2", email: null }), { email: null, userId: "u2" });
  // Device keys and the home network don't say who it is.
  assert.equal(viewerFromAuth({ via: "key", userId: null }), null);
  assert.equal(viewerFromAuth({ via: "lan", userId: null }), null);
  assert.equal(viewerFromAuth({ via: "token", userId: null, sub: "key:abc" }), null);
});

test("e-mail joins ESPG links and 24/7 logins into one person", () => {
  assert.equal(viewerKey({ email: "J@x.test", userId: "u1" }), "email:j@x.test");
  assert.equal(viewerKey({ email: null, userId: "u1" }), "user:u1");
  assert.equal(viewerKey({ email: null, userId: null }), null);
});

test("counts only this person's streams; a reconnect doesn't count against itself", () => {
  const sessions = [
    { viewer: "email:j@x.test", channelNumber: 1, clientIp: "10.0.0.5" },
    { viewer: "email:j@x.test", channelNumber: 2, clientIp: "10.0.0.6" },
    { viewer: "email:other@x.test", channelNumber: 1, clientIp: "10.0.0.7" },
    { viewer: null, channelNumber: 3 },
  ];
  assert.equal(countViewerStreams(sessions, "email:j@x.test"), 2);
  assert.equal(countViewerStreams(sessions, "email:j@x.test", { channelNumber: 3, clientIp: "10.0.0.5" }), 2);
  assert.equal(countViewerStreams(sessions, "email:j@x.test", { channelNumber: 1, clientIp: "10.0.0.5" }), 1);
  // Same channel from another address is a second stream.
  assert.equal(countViewerStreams(sessions, "email:j@x.test", { channelNumber: 1, clientIp: "10.9.9.9" }), 2);
});

test("refusal message says what the limit is", () => {
  const msg = viewerLimitMessage(linkedLimit({ tvConnections: 7, tvActive: 7 }), 1);
  assert.match(msg, /24\/7 stream limit reached/);
  assert.match(msg, /1 of 1/);
  assert.match(msg, /7 TV connections, 7 in use, plus 1 for 24\/7/);
});
