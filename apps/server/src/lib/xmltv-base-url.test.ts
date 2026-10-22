import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Readable } from "node:stream";
import {
  replaceBaseUrlPlaceholder,
  toPlaceholderIconUrl,
  XMLTV_BASE_URL_PLACEHOLDER as P,
} from "./xmltv-static-cache";

async function collect(stream: Readable): Promise<string> {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

describe("XMLTV cache base URL placeholder", () => {
  it("fills in the caller's address, even when the placeholder is split across chunks", async () => {
    const text = `<tv>\n  <icon src="${P}/images/plex?x=1" />\n  <url>${P}/api/video?channel=1</url>\n</tv>`;
    const chunks = [text.slice(0, 12), text.slice(12, 20), text.slice(20, 47), text.slice(47)];
    const out = await collect(replaceBaseUrlPlaceholder(Readable.from(chunks), "http://localhost:18247"));
    assert.equal(out, text.split(P).join("http://localhost:18247"));
    assert.equal(out.includes(P), false);
  });

  it("keeps relative and legacy collection icons on the caller's address", () => {
    assert.equal(toPlaceholderIconUrl("/images/plex?origin=a&path=b"), `${P}/images/plex?origin=a&path=b`);
    assert.equal(
      toPlaceholderIconUrl("https://247.midweststreams.us/images/plex?origin=a&path=b"),
      `${P}/images/plex?origin=a&path=b`,
    );
    assert.equal(toPlaceholderIconUrl("https://cdn.example.com/logo.png"), "https://cdn.example.com/logo.png");
  });
});
