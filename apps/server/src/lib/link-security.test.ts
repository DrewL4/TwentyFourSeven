import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FailureLimiter,
  clientAddress,
  isPrivateAddress,
  parsePlayerKeySecret,
  playerKeySecret,
  signLink,
  verifyLink,
} from "./link-security";

const secret = "unit-test-secret-not-real";
const now = 1_800_000_000_000;

test("a signed link opens only its own resource, scope and lifetime", () => {
  const t = signLink("video", "ch:5", "user:u1", 60, { now, secret });
  const ok = verifyLink(t, "video", "ch:5", { now, secret });
  assert.ok(ok.ok && ok.sub === "user:u1");
  assert.deepEqual(verifyLink(t, "video", "ch:6", { now, secret }), { ok: false, reason: "wrong-link" });
  assert.deepEqual(verifyLink(t, "image", "ch:5", { now, secret }), { ok: false, reason: "wrong-link" });
  assert.deepEqual(verifyLink(t, "video", "ch:5", { now: now + 61_000, secret }), { ok: false, reason: "expired" });
});

test("tampered or foreign tokens are refused", () => {
  const t = signLink("video", "ch:5", "user:u1", 60, { now, secret });
  const [body, sig] = t.split(".");
  // Swap the subject (another user) but keep the old signature.
  const forged = Buffer.from(JSON.stringify({ s: "video", r: "ch:5", u: "user:u2", e: now / 1000 + 60 })).toString("base64url");
  assert.equal(verifyLink(`${forged}.${sig}`, "video", "ch:5", { now, secret }).ok, false);
  assert.deepEqual(verifyLink(`${body}.${sig.slice(0, -2)}AA`, "video", "ch:5", { now, secret }), { ok: false, reason: "tampered" });
  assert.equal(verifyLink(t, "video", "ch:5", { now, secret: "other-secret" }).ok, false);
  for (const junk of ["", "abc", "a.b.c", "x".repeat(2000), "..", "%2e%2e"]) {
    assert.equal(verifyLink(junk, "video", "ch:5", { now, secret }).ok, false, junk);
  }
});

test("player keys: genuine secret maps to its id, anything else does not", () => {
  const k = playerKeySecret("cm1abcdef123", secret);
  assert.equal(parsePlayerKeySecret(k, secret), "cm1abcdef123");
  assert.equal(parsePlayerKeySecret(k.replace("cm1abcdef123", "cm1abcdef124"), secret), null);
  assert.equal(parsePlayerKeySecret(k.slice(0, -1) + (k.endsWith("A") ? "B" : "A"), secret), null);
  assert.equal(parsePlayerKeySecret(k, "other-secret"), null);
  assert.equal(parsePlayerKeySecret("pk1_../../etc_x", secret), null);
  assert.equal(parsePlayerKeySecret(null, secret), null);
});

test("failure limiter blocks after too many bad links, then lets go", () => {
  const lim = new FailureLimiter(3, 1000, 5000);
  lim.recordFailure("1.2.3.4", 0);
  lim.recordFailure("1.2.3.4", 10);
  assert.equal(lim.isBlocked("1.2.3.4", 20), false);
  lim.recordFailure("1.2.3.4", 20);
  assert.equal(lim.isBlocked("1.2.3.4", 30), true);
  assert.equal(lim.isBlocked("5.6.7.8", 30), false);
  assert.equal(lim.isBlocked("1.2.3.4", 6000), false);
});

test("private address detection", () => {
  for (const ip of ["10.1.2.3", "192.168.1.5", "172.20.0.1", "127.0.0.1", "::1", "::ffff:192.168.0.2", "fd00::1", "100.100.1.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "2001:db8::1", "", "garbage"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("clientAddress: a spoofed X-Forwarded-For cannot claim the LAN", () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });
  // nginx: X-Real-IP = socket peer, XFF = client's header + peer.
  assert.equal(clientAddress(h({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "192.168.1.2, 203.0.113.9" })), "203.0.113.9");
  // Behind a LAN reverse proxy: the proxy is private, the viewer is not.
  assert.equal(clientAddress(h({ "x-real-ip": "192.168.1.10", "x-forwarded-for": "10.0.0.5, 198.51.100.7, 192.168.1.10" })), "198.51.100.7");
  // A real LAN viewer.
  assert.equal(clientAddress(h({ "x-real-ip": "192.168.1.20", "x-forwarded-for": "192.168.1.20" })), "192.168.1.20");
});
