import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchChecked, isBlockedAddress, outboundUrlError, OutboundUrlRefused } from "./outbound-url";

const resolveTo = (...ips: string[]) => async () => ips;

test("blocked: link-local, metadata, multicast, unspecified, reserved (incl. IPv4-mapped)", () => {
  for (const ip of ["169.254.169.254", "169.254.1.1", "100.100.100.200", "0.0.0.0", "224.0.0.1", "255.255.255.255", "240.0.0.1",
    "::", "fe80::1", "ff02::1", "fd00:ec2::254", "::ffff:169.254.169.254", "[fe80::1%eth0]"]) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.20", "172.17.0.2", "100.64.1.2", "8.8.8.8", "::1", "fd7a:115c:a1e0::1", "2606:4700::1"]) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test("URL checks: scheme, credentials, IP literals and resolved names", async () => {
  assert.equal(await outboundUrlError("https://raw.githubusercontent.com/x.json", resolveTo("185.199.108.133")), null);
  assert.equal(await outboundUrlError("http://nas.lan:8080/feed.json", resolveTo("192.168.1.10")), null);
  assert.match((await outboundUrlError("file:///etc/passwd"))!, /only http/);
  assert.match((await outboundUrlError("gopher://x/"))!, /only http/);
  assert.match((await outboundUrlError("http://user:pw@example.test/"))!, /user name/);
  assert.match((await outboundUrlError("http://169.254.169.254/latest/meta-data/"))!, /not allowed/);
  assert.match((await outboundUrlError("http://[::ffff:a9fe:a9fe]/"))!, /not allowed/);
  assert.match((await outboundUrlError("http://[fd00:ec2::254]/"))!, /not allowed/);
  assert.match((await outboundUrlError("http://meta.example.test/", resolveTo("93.184.216.34", "169.254.169.254")))!, /169\.254\.169\.254/);
  assert.equal(await outboundUrlError("http://no-such-host.invalid/", async () => { throw new Error("ENOTFOUND"); }), null);
  assert.match((await outboundUrlError("not a url"))!, /valid URL/);
});

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test("fetchChecked follows allowed redirects and refuses a hop to metadata", async () => {
  const feed = await serve((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end('{"records":[1]}'));
  const hops = await serve((req, res) => {
    if (req.url === "/to-feed") res.writeHead(302, { location: `${feed.url}/feed.json` }).end();
    else if (req.url === "/to-metadata") res.writeHead(301, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    else if (req.url === "/loop") res.writeHead(302, { location: "/loop" }).end();
    else res.writeHead(404).end();
  });
  try {
    const ok = await fetchChecked(`${hops.url}/to-feed`);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { records: [1] });
    await assert.rejects(fetchChecked(`${hops.url}/to-metadata`), (e) => e instanceof OutboundUrlRefused && /169\.254/.test(e.message));
    await assert.rejects(fetchChecked(`${hops.url}/loop`), (e) => e instanceof OutboundUrlRefused && /redirects/.test(e.message));
    assert.equal((await fetchChecked(`${hops.url}/missing`)).status, 404);
  } finally {
    await feed.close();
    await hops.close();
  }
});

test("fetchChecked refuses before connecting when the first URL is blocked", async () => {
  let calls = 0;
  const fake = (async () => { calls++; return new Response("x"); }) as typeof fetch;
  await assert.rejects(fetchChecked("http://169.254.169.254/", {}, { fetch: fake }), OutboundUrlRefused);
  await assert.rejects(fetchChecked("http://rebind.test/", {}, { fetch: fake, resolve: resolveTo("169.254.169.254") }), OutboundUrlRefused);
  assert.equal(calls, 0);
});
