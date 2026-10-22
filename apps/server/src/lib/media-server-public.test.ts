import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlexCredentials, toPublicServer, tokenUpdate } from "./media-server-public";

test("toPublicServer drops the token and reports whether one exists", () => {
  const out = toPublicServer({ id: "s1", url: "http://plex:32400", token: "secret-value" });
  assert.equal("token" in out, false);
  assert.equal(out.hasToken, true);
  assert.equal(JSON.stringify(out).includes("secret-value"), false);
  assert.equal(toPublicServer({ id: "s2", token: null }).hasToken, false);
});

test("a blank token field keeps the stored token", () => {
  assert.equal(tokenUpdate(""), undefined);
  assert.equal(tokenUpdate("   "), undefined);
  assert.equal(tokenUpdate(undefined), undefined);
  assert.equal(tokenUpdate(" new "), "new");
});

test("stored token is only ever paired with the stored URL", () => {
  const stored = { url: "http://plex.lab:32400", token: "stored" };
  assert.deepEqual(resolvePlexCredentials({ url: "http://evil.example" }, stored), stored);
  assert.deepEqual(resolvePlexCredentials({ serverId: "x" } as any, stored), stored);
  assert.deepEqual(
    resolvePlexCredentials({ url: "http://new:32400", token: "typed" }, stored),
    { url: "http://new:32400", token: "typed" },
  );
  assert.ok("error" in resolvePlexCredentials({ url: "http://a" }, null));
  assert.ok("error" in resolvePlexCredentials({}, { url: "http://a", token: null }));
  assert.ok("error" in resolvePlexCredentials({ token: "typed" }, null));
});
