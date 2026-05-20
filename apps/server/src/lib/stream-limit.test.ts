import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countActiveTranscodes,
  getTranscodeKey,
  isStreamCapacityReached,
  isUnlimitedConcurrentStreams,
  shouldRejectNewTranscode,
} from "./stream-limit";

describe("isStreamCapacityReached", () => {
  it("allows streams below the limit", () => {
    assert.equal(isStreamCapacityReached(0, 2), false);
    assert.equal(isStreamCapacityReached(1, 2), false);
  });

  it("returns 503 condition at capacity", () => {
    assert.equal(isStreamCapacityReached(2, 2), true);
    assert.equal(isStreamCapacityReached(5, 1), true);
  });

  it("treats zero or negative as unlimited", () => {
    assert.equal(isUnlimitedConcurrentStreams(0), true);
    assert.equal(isStreamCapacityReached(99, 0), false);
    assert.equal(isStreamCapacityReached(99, -1), false);
  });
});

describe("countActiveTranscodes", () => {
  it("counts distinct channel/program pairs, not viewer sessions", () => {
    const sessions = [
      { channelNumber: 1, programInfo: { ratingKey: "100" } },
      { channelNumber: 1, programInfo: { ratingKey: "100" } },
      { channelNumber: 2, programInfo: { ratingKey: "200" } },
    ];
    assert.equal(countActiveTranscodes(sessions), 2);
    assert.equal(getTranscodeKey(1, "100"), "1:100");
  });
});

describe("shouldRejectNewTranscode", () => {
  const active = [{ channelNumber: 1, programInfo: { ratingKey: "100" } }];

  it("allows another viewer on the same channel/program when limit is 1", () => {
    assert.equal(
      shouldRejectNewTranscode(active, 1, "100", 1),
      false,
    );
  });

  it("blocks a second distinct transcode when limit is 1", () => {
    assert.equal(
      shouldRejectNewTranscode(active, 2, "200", 1),
      true,
    );
  });

  it("never rejects when limit is unlimited", () => {
    assert.equal(
      shouldRejectNewTranscode(active, 2, "200", 0),
      false,
    );
  });
});
