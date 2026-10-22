import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mediaImageSrc } from "./media-image";

describe("mediaImageSrc", () => {
  it("routes Plex artwork through the proxy and drops the token", () => {
    const out = mediaImageSrc("http://plex.lab.test:32400/library/metadata/1/thumb/179?X-Plex-Token=SECRET");
    assert.equal(
      out,
      "/images/plex?origin=http%3A%2F%2Fplex.lab.test%3A32400&path=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F179",
    );
    assert.equal(out!.includes("SECRET"), false);
  });

  it("keeps other query parameters on the Plex path", () => {
    assert.equal(
      mediaImageSrc("https://1-2-3-4.abc.plex.direct:32400/photo/:/transcode?width=300&X-Plex-Token=t"),
      "/images/plex?origin=https%3A%2F%2F1-2-3-4.abc.plex.direct%3A32400&path=%2Fphoto%2F%3A%2Ftranscode%3Fwidth%3D300",
    );
  });

  it("leaves non-Plex, relative and empty values alone", () => {
    assert.equal(mediaImageSrc("https://image.tmdb.org/t/p/w500/x.jpg"), "https://image.tmdb.org/t/p/w500/x.jpg");
    assert.equal(mediaImageSrc("/images/plex?origin=a&path=b"), "/images/plex?origin=a&path=b");
    assert.equal(mediaImageSrc(null), undefined);
    assert.equal(mediaImageSrc(""), undefined);
  });
});
