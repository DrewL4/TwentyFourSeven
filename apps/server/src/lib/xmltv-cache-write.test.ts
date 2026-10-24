import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "xmltv-write-"));
process.env.XMLTV_STATIC_PATH = path.join(dir, "guide.xml");
const load = () => import("./xmltv-static-cache");

describe("XMLTV cache streaming write", () => {
  it("writes every line in order when the guide is far larger than the stream buffer", async () => {
    const line = "x".repeat(1000);
    const { writeXmlTvCacheStreaming } = await load();
    let waited = 0;
    await writeXmlTvCacheStreaming(async (write) => {
      for (let i = 0; i < 5000; i++) {
        const pending = write(`${i} ${line}`);
        let settled = false;
        pending.then(() => { settled = true; });
        await Promise.resolve();
        if (!settled) waited++;
        await pending;
      }
    });
    const lines = readFileSync(process.env.XMLTV_STATIC_PATH!, "utf8").split("\n");
    assert.equal(lines.length, 5001);
    assert.equal(lines[4999], `4999 ${line}`);
    assert.ok(waited > 0, "the writer waits for the disk instead of buffering the whole guide");
    assert.deepEqual(readdirSync(dir), ["guide.xml"]);
  });

  it("leaves the old guide and no temp file behind when the build fails", async () => {
    const { writeXmlTvCacheStreaming } = await load();
    const before = readFileSync(process.env.XMLTV_STATIC_PATH!, "utf8");
    await assert.rejects(
      writeXmlTvCacheStreaming(async (write) => {
        await write("<tv>");
        throw new Error("db down");
      }),
      /db down/,
    );
    assert.equal(readFileSync(process.env.XMLTV_STATIC_PATH!, "utf8"), before);
    assert.deepEqual(readdirSync(dir), ["guide.xml"]);
  });
});
