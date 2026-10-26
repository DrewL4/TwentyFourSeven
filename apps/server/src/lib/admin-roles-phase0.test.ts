import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ORPCError, call } from "@orpc/server";

// Admin roles Phase 0: a deactivated user's old session is refused, and a WatchTower
// demotion, deactivation or deletion signs the user out of every TFS session.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-adminp0-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
let prisma: typeof import("./prisma").prisma;
let hub: import("./watchtower-hub-service").WatchTowerHubService;
let orpc: typeof import("./orpc");

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("./prisma"));
  const { WatchTowerHubService } = await import("./watchtower-hub-service");
  hub = WatchTowerHubService.getInstance();
  orpc = await import("./orpc");
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const now = () => new Date();
const ID = "u-ann";
const EMAIL = "ann@example.test";

async function seed(role = "ADMIN", isActive = true) {
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.user.create({
    data: { id: ID, name: "ann", email: EMAIL, emailVerified: true, role, isActive, createdAt: now(), updatedAt: now(), watchTowerUserId: "7" },
  });
  for (const t of ["s1", "s2"]) {
    await prisma.session.create({
      data: { id: t, token: `tok-${t}`, userId: ID, expiresAt: new Date(Date.now() + 86400000), createdAt: now(), updatedAt: now() },
    });
  }
}

const sessions = () => prisma.session.count({ where: { userId: ID } });

function wtUser(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 7, email: EMAIL, username: "ann", is_active: true, is_admin: true, is_family: false,
    movie_service: "Plex", is_movie_user: true, movie_donation_due: "2099-01-01", ...overrides,
  };
}

const update = (data: Record<string, unknown>) =>
  hub.handleWebhookEvent({ event_type: "user.updated", timestamp: now().toISOString(), data } as any);

describe("WatchTower changes sign the user out of TFS", () => {
  beforeEach(() => seed());

  it("demotion from admin deletes every session", async () => {
    await update(wtUser({ is_admin: false }));
    const u = await prisma.user.findUnique({ where: { id: ID } });
    assert.equal(u?.role, "USER");
    assert.equal(await sessions(), 0);
  });

  it("deactivation deletes every session, even for an admin", async () => {
    await update(wtUser({ is_active: false }));
    const u = await prisma.user.findUnique({ where: { id: ID } });
    assert.equal(u?.isActive, false);
    assert.equal(await sessions(), 0);
  });

  it("deletion in WatchTower deletes every session", async () => {
    await hub.handleWebhookEvent({ event_type: "user.deleted", timestamp: now().toISOString(), data: wtUser() } as any);
    assert.equal(await sessions(), 0);
  });

  it("an ordinary update keeps sessions", async () => {
    await update(wtUser({ username: "ann2" }));
    assert.equal(await sessions(), 2);
  });
});

describe("requireAuth refuses inactive users", () => {
  const ctx = () => ({ session: { user: { id: ID } } as any, db: prisma });

  it("an inactive user's old session gets 401", async () => {
    await seed("USER", false);
    const proc = orpc.protectedProcedure.handler(() => "ok");
    await assert.rejects(call(proc, undefined, { context: ctx() }), (e: unknown) => e instanceof ORPCError && e.code === "UNAUTHORIZED");
  });

  it("an active user passes", async () => {
    await seed("USER", true);
    const proc = orpc.protectedProcedure.handler(() => "ok");
    assert.equal(await call(proc, undefined, { context: ctx() }), "ok");
  });

  it("an inactive admin is refused by adminProcedure", async () => {
    await seed("ADMIN", false);
    const proc = orpc.adminProcedure.handler(() => "ok");
    await assert.rejects(call(proc, undefined, { context: ctx() }), (e: unknown) => e instanceof ORPCError && e.code === "UNAUTHORIZED");
  });
});
