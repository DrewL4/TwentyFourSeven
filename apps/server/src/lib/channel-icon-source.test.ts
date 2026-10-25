import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { channelIconSource, schemeOf } from "./channel-icon-source";
import { createPlayerImageLinker } from "./plex-image";
import { channelIconsForGuide } from "./xmltv-channel-icons";
import {
  replaceBaseUrlPlaceholder,
  XMLTV_BASE_URL_PLACEHOLDER,
  XMLTV_IMAGE_PASS_PLACEHOLDER,
  XMLTV_SCHEME_PLACEHOLDER,
} from "./xmltv-static-cache";

test("channelIconSource keeps http(s), local artwork and protocol-relative icons", () => {
  assert.equal(channelIconSource("https://cdn.example.test/a b.png", "http"), "https://cdn.example.test/a%20b.png");
  assert.equal(channelIconSource("/images/local/abc/poster", "http"), "/images/local/abc/poster");
  assert.equal(channelIconSource("//cdn.example.test/logo.png", "https"), "https://cdn.example.test/logo.png");
  assert.equal(channelIconSource("//cdn.example.test/logo.png", XMLTV_SCHEME_PLACEHOLDER), `${XMLTV_SCHEME_PLACEHOLDER}://cdn.example.test/logo.png`);
  for (const bad of [null, undefined, "", "relative/logo.png", "/images/other.png", "https://", "//", "ftp://x.example.test/a.png"]) {
    assert.equal(channelIconSource(bad, "https"), null, String(bad));
  }
});

test("schemeOf reads the scheme of a public base URL", () => {
  assert.equal(schemeOf("https://tv.example.test"), "https");
  assert.equal(schemeOf("http://192.168.1.20:8247"), "http");
});

const linker = (pass: string) => createPlayerImageLinker([{ url: "http://plex.example.test:32400", token: "t" }], { pass });

test("M3U: local icons use the public base URL and image pass; // uses the request scheme", () => {
  const baseUrl = "https://tv.example.test";
  const link = (u: string) => linker("PASS")(u, baseUrl);
  assert.equal(link(channelIconSource("/images/local/abc/poster", schemeOf(baseUrl))!), "https://tv.example.test/images/local/abc/poster?t=PASS");
  assert.equal(link(channelIconSource("//cdn.example.test/logo.png", schemeOf(baseUrl))!), "https://cdn.example.test/logo.png");
  assert.equal(link(channelIconSource("//cdn.example.test/logo.png", schemeOf("http://10.0.0.5:8247"))!), "http://cdn.example.test/logo.png");
});

test("XMLTV: the cached guide's icons are completed per request", async () => {
  const icons = channelIconsForGuide(
    [
      { id: "local", icon: "/images/local/abc/poster", cachedCollectionIcon: null },
      { id: "proto", icon: "//cdn.example.test/logo.png", cachedCollectionIcon: null },
    ],
    [],
    (u) => linker(XMLTV_IMAGE_PASS_PLACEHOLDER)(u, XMLTV_BASE_URL_PLACEHOLDER),
    XMLTV_SCHEME_PLACEHOLDER,
  );
  const cached = [...icons.values()].map((u) => `<icon src="${u}" />`).join("\n") + "\n";
  const fill = async (base: string) => {
    let out = "";
    const stream = replaceBaseUrlPlaceholder(Readable.from([cached]), base, {
      [XMLTV_IMAGE_PASS_PLACEHOLDER]: "PASS",
      [XMLTV_SCHEME_PLACEHOLDER]: schemeOf(base),
    });
    for await (const chunk of stream) out += chunk;
    return out.trim().split("\n");
  };
  assert.deepEqual(await fill("https://tv.example.test"), [
    '<icon src="https://tv.example.test/images/local/abc/poster?t=PASS" />',
    '<icon src="https://cdn.example.test/logo.png" />',
  ]);
  assert.deepEqual(await fill("http://192.168.1.20:8247"), [
    '<icon src="http://192.168.1.20:8247/images/local/abc/poster?t=PASS" />',
    '<icon src="http://cdn.example.test/logo.png" />',
  ]);
});
