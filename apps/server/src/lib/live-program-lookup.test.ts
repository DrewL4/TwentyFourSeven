import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelNotFoundError, requireLiveProgram, videoErrorStatus } from "./live-program-lookup";

describe("requireLiveProgram", () => {
  it("returns the live program", async () => {
    const live = await requireLiveProgram(1, { loadLive: async () => ({ id: "p1" }), channelExists: async () => true });
    assert.deepEqual(live, { id: "p1" });
  });

  it("a channel that doesn't exist is a 404, not a 500", async () => {
    const err = await requireLiveProgram(999, { loadLive: async () => null, channelExists: async () => false }).catch((e) => e);
    assert.ok(err instanceof ChannelNotFoundError);
    assert.equal(err.message, "Channel not found");
    assert.equal(videoErrorStatus(err), 404);
  });

  it("an existing channel with nothing playable keeps the old 500", async () => {
    const err = await requireLiveProgram(3, { loadLive: async () => null, channelExists: async () => true }).catch((e) => e);
    assert.ok(!(err instanceof ChannelNotFoundError));
    assert.equal(err.message, "Channel or program not found");
    assert.equal(videoErrorStatus(err), 500);
  });

  it("does not look the channel up when a program is found", async () => {
    let looked = false;
    await requireLiveProgram(1, { loadLive: async () => ({}), channelExists: async () => ((looked = true), true) });
    assert.equal(looked, false);
  });
});
