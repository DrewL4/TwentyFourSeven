import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDay, releaseText, statusView } from "../components/franchises/request-status";

describe("statusView", () => {
  it("offers Request only when nobody has a live request, or it was declined or failed", () => {
    assert.equal(statusView(null, false).canRequest, true);
    assert.equal(statusView(null, false).text, "Missing from your library");
    for (const state of ["pending", "approved", "downloading", "available", "requested"] as const) {
      assert.equal(statusView({ state, requestedByMe: true }, false).canRequest, false, state);
    }
    const denied = statusView({ state: "denied", requestedByMe: false }, true);
    assert.deepEqual([denied.canRequest, denied.requestLabel], [true, "Request again"]);
    assert.equal(statusView({ state: "failed", requestedByMe: true }, false).requestLabel, "Try again");
  });

  it("says each real stage in plain words, and never who else asked", () => {
    assert.match(statusView({ state: "pending", requestedByMe: false }, false).text, /waiting for approval \(by another user\)/);
    assert.match(statusView({ state: "approved", requestedByMe: true }, false).text, /Approved, searching for it \(by you\)/);
    assert.match(statusView({ state: "downloading", requestedByMe: true }, false).text, /Downloading now/);
    assert.match(statusView({ state: "available", requestedByMe: false }, false).text, /Ready in WatchTower/);
  });

  it("falls back to 24/7's own note only when WatchTower gave no answer", () => {
    assert.equal(statusView(null, true).text, "Requested");
    assert.equal(statusView(null, true).canRequest, false);
  });
});

describe("releaseText", () => {
  it("formats days without a time zone shift", () => {
    assert.equal(formatDay("2026-12-18"), "Dec 18, 2026");
    assert.equal(formatDay("2027-01-01"), "Jan 1, 2027");
  });

  it("shows theatrical and digital dates, premieres, next episodes and undated titles", () => {
    const base = { theatrical: null, theatricalOut: false, digital: null, digitalOut: false, coming: null, nextEpisode: null, undated: false };
    assert.equal(releaseText({ ...base, theatrical: "2026-12-18", digital: "2027-02-10" }), "In theaters Dec 18, 2026 · Digital Feb 10, 2027");
    assert.equal(releaseText({ ...base, theatrical: "2026-10-01", theatricalOut: true, digital: "2026-12-01" }), "In theaters now · Digital Dec 1, 2026");
    assert.equal(releaseText({ ...base, coming: "2027-03-03" }), "Coming Mar 3, 2027");
    assert.equal(releaseText({ ...base, nextEpisode: "2026-11-05" }), "Next episode Nov 5, 2026");
    assert.equal(releaseText({ ...base, undated: true }), "Release date not announced");
    assert.equal(releaseText(null), "");
  });
});
