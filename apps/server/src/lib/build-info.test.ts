import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBuildInfo } from "./build-info";

const missing = join(tmpdir(), "tfs-no-build-info.json");

test("reports the CI build args when the image has no build file", () => {
  assert.deepEqual(
    getBuildInfo({ APP_VERSION: "2026.10.23", GIT_SHA: "abc1234", BUILD_DATE: "2026-10-23T17:00:00Z", SECRET: "x" }, missing),
    { version: "2026.10.23", revision: "abc1234", build_date: "2026-10-23T17:00:00Z" },
  );
});

test("falls back to dev when the args are missing", () => {
  assert.deepEqual(getBuildInfo({ APP_VERSION: " " }, missing), { version: "dev", revision: "", build_date: "" });
});

test("the build file wins over stale env copied from an old container", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-build-"));
  const file = join(dir, "build-info.json");
  writeFileSync(file, JSON.stringify({ version: "2026.10.24", revision: "new1234", build_date: "2026-10-24T01:00:00Z" }));
  assert.deepEqual(getBuildInfo({ APP_VERSION: "2026.10.01", GIT_SHA: "old0000", BUILD_DATE: "2026-10-01" }, file), {
    version: "2026.10.24",
    revision: "new1234",
    build_date: "2026-10-24T01:00:00Z",
  });
});

test("an empty build file (local docker build) falls back to env", () => {
  const dir = mkdtempSync(join(tmpdir(), "tfs-build-"));
  const file = join(dir, "build-info.json");
  writeFileSync(file, '{"version":"","revision":"","build_date":""}\n');
  assert.equal(getBuildInfo({ APP_VERSION: "1.2.3" }, file).version, "1.2.3");
  writeFileSync(file, "not json");
  assert.equal(getBuildInfo({}, file).version, "dev");
});
