import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// A WatchTower sign-in must add a session, not replace the user's others (a phone sign-in
// used to sign the TV out). A drop in role or active status still ends every session.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-ssosession-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
let prisma: typeof import("./prisma").prisma;
let auth: typeof import("./auth").auth;
let start: typeof import("./wt-sso-session").startSessionForExistingUser;

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("./prisma"));
  ({ auth } = await import("./auth"));
  ({ startSessionForExistingUser: start } = await import("./wt-sso-session"));
});

after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const EMAIL = "ann@example.test";
let userId = "";

async function seed(withCredential: boolean, role = "ADMIN") {
  await prisma.session.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});
  const created = await auth.api.signUpEmail({ body: { name: "ann", email: EMAIL, password: "first-password-123" } });
  userId = created.user.id;
  await prisma.session.deleteMany({}); // sign-up itself opens a session
  await prisma.user.update({ where: { id: userId }, data: { role, isActive: true } });
  if (!withCredential) await prisma.account.deleteMany({ where: { userId } });
  for (const t of ["tv", "phone"]) {
    await prisma.session.create({
      data: { id: `s-${t}`, token: `tok-${t}`, userId, expiresAt: new Date(Date.now() + 86400000), createdAt: new Date(), updatedAt: new Date() },
    });
  }
}

const sessionIds = async () => (await prisma.session.findMany({ where: { userId }, select: { id: true } })).map((s) => s.id).sort();

async function signIn(password: string) {
  return (await auth.api.signInEmail({ body: { email: EMAIL, password }, asResponse: true })) as Response;
}

describe("startSessionForExistingUser", () => {
  beforeEach(() => undefined);

  it("a new sign-in adds a session and keeps the other devices' sessions", async () => {
    await seed(true);
    const { tempPassword, signedOutEverywhere } = await start({
      userId,
      before: { isActive: true, role: "ADMIN" },
      after: { isActive: true, role: "ADMIN" },
    });
    assert.equal(signedOutEverywhere, false);
    const res = await signIn(tempPassword);
    assert.equal(res.ok, true);
    assert.deepEqual((await sessionIds()).filter((id) => id.startsWith("s-")), ["s-phone", "s-tv"]);
    assert.equal((await sessionIds()).length, 3);
    assert.equal(await prisma.user.count({ where: { id: userId } }), 1, "same user row and id");
  });

  it("the old password stops working once the throw-away one is set", async () => {
    await seed(true);
    await start({ userId, before: { isActive: true, role: "ADMIN" }, after: { isActive: true, role: "ADMIN" } });
    assert.equal((await signIn("first-password-123")).ok, false);
  });

  it("works for a user that has no credential account yet", async () => {
    await seed(false);
    const { tempPassword } = await start({ userId, before: { isActive: true, role: "USER" }, after: { isActive: true, role: "USER" } });
    assert.equal((await signIn(tempPassword)).ok, true);
    assert.equal((await sessionIds()).length, 3);
  });

  it("a role drop still ends every session before the new one is issued", async () => {
    await seed(true, "ADMIN");
    const { tempPassword, signedOutEverywhere } = await start({
      userId,
      before: { isActive: true, role: "ADMIN" },
      after: { isActive: true, role: "USER" },
    });
    assert.equal(signedOutEverywhere, true);
    assert.deepEqual(await sessionIds(), []);
    assert.equal((await signIn(tempPassword)).ok, true);
    assert.equal((await sessionIds()).length, 1);
  });

  it("losing active status ends every session", async () => {
    await seed(true, "USER");
    const r = await start({ userId, before: { isActive: true, role: "USER" }, after: { isActive: false, role: "USER" } });
    assert.equal(r.signedOutEverywhere, true);
    assert.deepEqual(await sessionIds(), []);
  });
});
