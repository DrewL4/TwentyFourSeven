import { test } from "node:test";
import assert from "node:assert/strict";
import { badPlexWebhookKey, isPlexKey, plexKeySegment } from "./plex-keys";

test("Plex keys are digits only", () => {
  for (const ok of ["1", "16", "123456789012", 42]) assert.equal(isPlexKey(ok), true, String(ok));
  for (const bad of ["", "1/children", "../../accounts", "1?X-Plex-Token=x", "1%2F..", " 1", "1234567890123", "-1", "1.5", null, undefined, {}]) {
    assert.equal(isPlexKey(bad), false, String(bad));
  }
});

test("a key path segment cannot climb to another Plex endpoint", () => {
  assert.equal(plexKeySegment("16"), "16");
  const url = new URL(`http://plex.lab.test:32400/library/metadata/${plexKeySegment("../../accounts")}`);
  assert.equal(url.pathname, "/library/metadata/..%2F..%2Faccounts");
  assert.equal(new URL(`http://plex.lab.test/library/metadata/${plexKeySegment("1?a=b#c")}`).search, "");
});

test("webhook metadata: real Plex payloads pass, traversal keys are named", () => {
  assert.equal(badPlexWebhookKey({ ratingKey: "16", parentRatingKey: "15", grandparentRatingKey: "14", librarySectionID: 2 }), null);
  assert.equal(badPlexWebhookKey({ ratingKey: "16" }), null);
  assert.equal(badPlexWebhookKey(undefined), null);
  assert.equal(badPlexWebhookKey({ ratingKey: "16/../../../:/prefs" }), "ratingKey");
  assert.equal(badPlexWebhookKey({ ratingKey: "16", grandparentRatingKey: "x" }), "grandparentRatingKey");
  assert.equal(badPlexWebhookKey({ ratingKey: "16", librarySectionID: "2 OR 1" }), "librarySectionID");
});
