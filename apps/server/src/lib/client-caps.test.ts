import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { parseCapsDeclaration, resolveClientCaps } from "./client-caps";

const resolve = (query: string, userAgent?: string, capsHeader?: string) =>
  resolveClientCaps({ params: new URLSearchParams(query), userAgent, capsHeader });

afterEach(() => {
  delete process.env.TFS_UNKNOWN_CLIENTS;
  delete process.env.TFS_MWS_TV_HDR;
  delete process.env.TFS_DIRECT_MAX_KBPS;
});

describe("resolveClientCaps", () => {
  it("browser=1 is H.264 8-bit SDR only", () => {
    const c = resolve("channel=1&browser=1", "Mozilla/5.0 Chrome/130");
    assert.equal(c.id, "browser");
    assert.deepEqual([...c.codecs], ["h264"]);
    assert.equal(c.hevc10, false);
    assert.equal(c.hdr, false);
    assert.equal(c.browser, true);
  });

  it("MWS-TV is an Android TV profile: HEVC, 10-bit, HDR, 4K, no copy=1 needed", () => {
    const c = resolve("channel=1", "MWS-TV/1.7.3 (Living Room)");
    assert.equal(c.id, "tv");
    assert.ok(c.codecs.has("hevc"));
    assert.equal(c.hevc10, true);
    assert.equal(c.hdr, true);
    assert.equal(c.maxHeight, 2160);
    assert.equal(c.maxKbps, 40_000);
    assert.equal(c.forceTranscode, false);
  });

  it("MWS-TV HDR and bitrate ceiling come from env", () => {
    process.env.TFS_MWS_TV_HDR = "false";
    process.env.TFS_DIRECT_MAX_KBPS = "30000";
    const c = resolve("channel=1", "MWS-TV/1.7.3 (Den)");
    assert.equal(c.hdr, false);
    assert.equal(c.maxKbps, 30_000);
  });

  it("copy=0 forces a transcode, even from MWS-TV, and shares one class", () => {
    const c = resolve("channel=1&copy=0", "MWS-TV/1.7.3 (Den)");
    assert.equal(c.forceTranscode, true);
    assert.equal(c.id, "transcode");
  });

  it("copy=1 from an unknown app keeps the old contract: 8-bit, SDR, 25 Mbps", () => {
    const c = resolve("channel=1&copy=1", "SomeBox/2.0");
    assert.equal(c.id, "legacy-copy");
    assert.equal(c.hevc10, false);
    assert.equal(c.hdr, false);
    assert.equal(c.maxKbps, 25_000);
    assert.equal(c.trustUnknownSource, true);
  });

  it("a known IPTV player decodes HEVC 10-bit but not HDR", () => {
    const c = resolve("channel=1", "TiviMate/5.0.4");
    assert.equal(c.id, "player");
    assert.equal(c.hevc10, true);
    assert.equal(c.hdr, false);
  });

  it("an unknown client is safe by default, and TFS_UNKNOWN_CLIENTS widens or narrows it", () => {
    const safe = resolve("channel=1", "WeirdPlayer/9");
    assert.equal(safe.id, "generic");
    assert.equal(safe.hdr, false);
    assert.equal(safe.hevc10, false);
    assert.equal(safe.trustUnknownSource, false);
    process.env.TFS_UNKNOWN_CLIENTS = "direct";
    assert.equal(resolve("channel=1", "WeirdPlayer/9").trustUnknownSource, true);
    process.env.TFS_UNKNOWN_CLIENTS = "transcode";
    assert.equal(resolve("channel=1", "WeirdPlayer/9").forceTranscode, true);
  });

  it("declared caps win over the User-Agent; browser=1 wins over everything", () => {
    const c = resolve("channel=1&caps=hevc,hdr,maxh=1080", "MWS-TV/1.7.3 (Den)");
    assert.equal(c.source, "declared");
    assert.equal(c.maxHeight, 1080);
    assert.equal(c.hdr, true);
    assert.equal(resolve("channel=1&browser=1&caps=hevc,hdr", "x").id, "browser");
  });

  it("caps can come in the X-TFS-Caps header", () => {
    const c = resolve("channel=1", "Foo/1", "h264 hevc hevc10");
    assert.equal(c.source, "declared");
    assert.equal(c.hevc10, true);
  });
});

describe("parseCapsDeclaration", () => {
  it("lists only what the client names; nothing named means H.264", () => {
    const c = parseCapsDeclaration("sdr")!;
    assert.deepEqual([...c.codecs], ["h264"]);
    assert.equal(c.hdr, false);
  });
  it("hdr implies 10-bit decode only when it has HEVC", () => {
    assert.equal(parseCapsDeclaration("hevc,hdr10")!.hevc10, true);
    assert.equal(parseCapsDeclaration("h264,hdr")!.hevc10, false);
  });
  it("ignores garbage", () => {
    assert.equal(parseCapsDeclaration("lol,wat"), null);
    assert.equal(parseCapsDeclaration(""), null);
    assert.equal(parseCapsDeclaration(null), null);
  });
  it("same declaration, same hub class; different declaration, different class", () => {
    assert.equal(parseCapsDeclaration("hevc,hdr")!.id, parseCapsDeclaration("hdr, hevc")!.id);
    assert.notEqual(parseCapsDeclaration("hevc,hdr")!.id, parseCapsDeclaration("hevc")!.id);
  });
  it("reads maxkbps and maxh", () => {
    const c = parseCapsDeclaration("hevc,maxkbps=18000,maxh=1080")!;
    assert.equal(c.maxKbps, 18_000);
    assert.equal(c.maxHeight, 1080);
  });
});
