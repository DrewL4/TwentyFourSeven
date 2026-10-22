import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPublicBaseUrl } from "./public-base-url";

const h = (values: Record<string, string>) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe("getPublicBaseUrl", () => {
  it("keeps the mapped port and http scheme the user typed", () => {
    assert.equal(
      getPublicBaseUrl(h({ host: "localhost:18247", "x-forwarded-proto": "http" })),
      "http://localhost:18247",
    );
  });

  it("uses the reverse proxy's scheme and host", () => {
    assert.equal(
      getPublicBaseUrl(
        h({ host: "tfs:80", "x-forwarded-proto": "https", "x-forwarded-host": "tv.example.com" }),
      ),
      "https://tv.example.com",
    );
  });

  it("takes the first value of a comma-separated forwarded chain", () => {
    assert.equal(
      getPublicBaseUrl(
        h({ "x-forwarded-proto": "https, http", "x-forwarded-host": "tv.example.com, tfs:80" }),
      ),
      "https://tv.example.com",
    );
  });

  it("falls back to the request URL when no headers are present", () => {
    assert.equal(getPublicBaseUrl(h({}), "http://192.168.1.20:8247/media.m3u"), "http://192.168.1.20:8247");
  });

  it("drops the default port for the scheme", () => {
    assert.equal(
      getPublicBaseUrl(h({ host: "tv.example.com:443", "x-forwarded-proto": "https" })),
      "https://tv.example.com",
    );
    assert.equal(getPublicBaseUrl(h({ host: "box:80", "x-forwarded-proto": "http" })), "http://box");
  });

  it("ignores junk proto and host values", () => {
    assert.equal(
      getPublicBaseUrl(h({ host: "evil.com/\"><x", "x-forwarded-proto": "javascript" }), "http://localhost:3000/"),
      "http://localhost",
    );
  });

  it("keeps IPv6 hosts", () => {
    assert.equal(getPublicBaseUrl(h({ host: "[::1]:8247" })), "http://[::1]:8247");
  });
});
