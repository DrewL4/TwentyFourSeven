import { test } from "node:test";
import assert from "node:assert/strict";
import { getBuildInfo } from "./build-info";

test("reports the CI build args", () => {
  assert.deepEqual(
    getBuildInfo({ APP_VERSION: "2026.10.23", GIT_SHA: "abc1234", BUILD_DATE: "2026-10-23T17:00:00Z", SECRET: "x" }),
    { version: "2026.10.23", revision: "abc1234", build_date: "2026-10-23T17:00:00Z" },
  );
});

test("falls back to dev when the args are missing", () => {
  assert.deepEqual(getBuildInfo({ APP_VERSION: " " }), { version: "dev", revision: "", build_date: "" });
});
