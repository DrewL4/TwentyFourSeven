import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMinutes } from "./format-duration";

describe("formatMinutes", () => {
  it("turns milliseconds into whole minutes", () => {
    assert.equal(formatMinutes(5_700_000), "95 min");
    assert.equal(formatMinutes(888_000), "15 min");
    assert.equal(formatMinutes("1320000"), "22 min");
  });

  it("shows at least 1 min for very short items", () => {
    assert.equal(formatMinutes(20_000), "1 min");
  });

  it("returns null instead of NaN when the length is missing", () => {
    assert.equal(formatMinutes(undefined), null);
    assert.equal(formatMinutes(null), null);
    assert.equal(formatMinutes(0), null);
    assert.equal(formatMinutes("abc"), null);
    assert.equal(formatMinutes(Number.NaN), null);
  });
});
