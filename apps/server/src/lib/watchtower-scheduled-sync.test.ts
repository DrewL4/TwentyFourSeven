import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The scheduled WatchTower sync used to POST each user to "/api/admin/import-user".
// A relative URL is rejected by server-side fetch, so every user was counted as skipped
// and nobody was imported. It now calls the same import function the route uses.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-wtsync-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
let prisma: typeof import("./prisma").prisma;
let WatchTowerService: typeof import("./watchtower-service").WatchTowerService;
const realFetch = globalThis.fetch;
const fetched: string[] = [];

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("./prisma"));
  ({ WatchTowerService } = await import("./watchtower-service"));
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/api/login/")) return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
    if (url.endsWith("/api/admin/export-users/")) {
      return new Response(JSON.stringify({ users: [
        { email: "ann@example.test", first_name: "Ann", last_name: "A", username: "ann", tv_service: 1, is_active: true, date_joined: "2024-01-02T00:00:00Z" },
        { email: "bob@example.test", first_name: "", last_name: "", username: "bob", tv_service: 1, is_active: true, date_joined: null },
        { email: "cat@example.test", first_name: "Cat", last_name: "", username: "cat", tv_service: null, is_active: true },
        { email: "dan@example.test", first_name: "Dan", last_name: "", username: "dan", tv_service: 1, is_active: false },
      ] }), { status: 200 });
    }
    return realFetch(input as any);
  }) as typeof fetch;
});
after(async () => {
  globalThis.fetch = realFetch;
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

test("scheduled sync imports active TV users, then updates them on the next run", async () => {
  const svc = WatchTowerService.getInstance();
  await prisma.settings.create({
    data: {
      id: "singleton",
      watchTowerEnabled: true,
      watchTowerUrl: "http://wt.invalid",
      watchTowerUsername: "sync",
      watchTowerPassword: svc.encryptPassword("not-a-real-password"),
    } as any,
  });

  const first = await svc.syncUsers();
  assert.deepEqual(first, { created: 2, updated: 0, skipped: 0, total: 4 });
  assert.ok(!fetched.some((u) => u.includes("import-user")), "no HTTP hop to the admin route");

  const ann = await prisma.user.findUnique({ where: { email: "ann@example.test" } });
  assert.equal(ann?.name, "Ann A");
  assert.equal(ann?.watchTowerJoinDate?.toISOString(), "2024-01-02T00:00:00.000Z");
  const bob = await prisma.user.findUnique({ where: { email: "bob@example.test" } });
  assert.equal(bob?.name, "bob");
  assert.equal(await prisma.user.count({ where: { email: { in: ["cat@example.test", "dan@example.test"] } } }), 0);

  const second = await svc.syncUsers();
  assert.deepEqual(second, { created: 0, updated: 2, skipped: 0, total: 4 });
  assert.equal(await prisma.user.count(), 2);
  assert.ok((await prisma.settings.findUnique({ where: { id: "singleton" } }))?.watchTowerLastSync);
});
