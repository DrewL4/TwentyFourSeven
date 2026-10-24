import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { emitUserUpdate, emitUsersRefresh, userRoom } from "./socket-io";

const require = createRequire(import.meta.url);
// server.js's own helper (plain CommonJS, outside the Next bundle).
const socketAuth = require("../../socket-auth.js") as {
  USERS_ROOM: string;
  userRoom(email: string): string;
  lookupSession(cookie: string | undefined, o: { port: number; fetchImpl?: unknown; timeoutMs?: number }): Promise<{ email: string; role?: string; isActive: boolean } | null>;
  roomsFor(s: { email: string; role?: string; isActive: boolean } | null): string[];
};

function fakeFetch(status: number, body: unknown, seen?: { url?: string; cookie?: string }) {
  return async (url: string, init: { headers: { cookie: string } }) => {
    if (seen) {
      seen.url = url;
      seen.cookie = init.headers.cookie;
    }
    return { ok: status >= 200 && status < 300, json: async () => body };
  };
}

describe("socket subscribe:users sign-in check", () => {
  it("no cookie: no session, no rooms, and the app is not even asked", async () => {
    let called = false;
    const s = await socketAuth.lookupSession(undefined, { port: 3000, fetchImpl: async () => ((called = true), null) });
    assert.equal(s, null);
    assert.equal(called, false);
    assert.deepEqual(socketAuth.roomsFor(s), []);
  });

  it("an invalid or expired cookie (session null) gets no rooms", async () => {
    const s = await socketAuth.lookupSession("tfs.session_token=dead", { port: 3000, fetchImpl: fakeFetch(200, { session: null, user: null }) });
    assert.equal(s, null);
    assert.deepEqual(socketAuth.roomsFor(s), []);
  });

  it("a failing or erroring session check gets no rooms", async () => {
    assert.equal(await socketAuth.lookupSession("c=1", { port: 3000, fetchImpl: fakeFetch(500, {}) }), null);
    assert.equal(await socketAuth.lookupSession("c=1", { port: 3000, fetchImpl: async () => { throw new Error("down"); } }), null);
  });

  it("an admin joins the all-users room plus their own; the cookie goes to the local app", async () => {
    const seen: { url?: string; cookie?: string } = {};
    const s = await socketAuth.lookupSession("tfs.session_token=ok", {
      port: 3000,
      fetchImpl: fakeFetch(200, { user: { id: "u1", email: "Admin@Example.com", role: "ADMIN", isActive: true } }, seen),
    });
    assert.equal(seen.url, "http://127.0.0.1:3000/api/user/session");
    assert.equal(seen.cookie, "tfs.session_token=ok");
    assert.deepEqual(socketAuth.roomsFor(s), ["users", "user:admin@example.com"]);
  });

  it("a non-admin only gets their own account's room (other users' emails stay private)", async () => {
    const s = await socketAuth.lookupSession("c=1", { port: 3000, fetchImpl: fakeFetch(200, { user: { id: "u2", email: "viewer@example.com", role: "USER" } }) });
    assert.deepEqual(socketAuth.roomsFor(s), ["user:viewer@example.com"]);
  });

  it("a disabled admin is not given the all-users room", () => {
    assert.deepEqual(socketAuth.roomsFor({ email: "a@x", role: "ADMIN", isActive: false }), ["user:a@x"]);
  });
});

describe("user update emitters", () => {
  it("send user:update to admins and to that account's own room; users:refresh to admins only", () => {
    const sent: Array<{ rooms: string[]; event: string }> = [];
    const fakeIo = {
      to(room: string) {
        const rooms = [room];
        const chain = {
          to(r: string) {
            rooms.push(r);
            return chain;
          },
          emit(event: string) {
            sent.push({ rooms, event });
          },
        };
        return chain;
      },
    };
    const g = globalThis as { io?: unknown };
    const prev = g.io;
    g.io = fakeIo;
    try {
      emitUserUpdate("Viewer@Example.com", "updated");
      emitUsersRefresh();
    } finally {
      g.io = prev;
    }
    assert.deepEqual(sent, [
      { rooms: ["users", "user:viewer@example.com"], event: "user:update" },
      { rooms: ["users"], event: "users:refresh" },
    ]);
    assert.equal(userRoom("A@B.c"), socketAuth.userRoom("A@B.c"));
  });
});
