import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCollectionIconResolver } from "./plex-collection-icons";

const libs = [
  { url: "http://plex-a.test:32400", token: "ta", key: "1" },
  { url: "http://plex-a.test:32400", token: "ta", key: "2" },
  { url: "http://plex-b.test:32400", token: "tb", key: "7" },
];
const dirs: Record<string, Array<{ title?: string; thumb?: string }>> = {
  "http://plex-a.test:32400/library/sections/1/collections": [{ title: "Marvel", thumb: "/library/collections/11/thumb" }],
  "http://plex-a.test:32400/library/sections/2/collections": [{ title: "Bond" }, { thumb: "/x" }],
  "http://plex-b.test:32400/library/sections/7/collections": [{ title: "Bond", thumb: "/library/collections/77/thumb" }],
};

function harness(failUrl?: string) {
  const calls: string[] = [];
  let listCalls = 0;
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (url === failUrl) throw new Error("down");
    return { ok: true, json: async () => ({ MediaContainer: { Directory: dirs[url] ?? [] } }) };
  }) as unknown as typeof fetch;
  const resolve = createCollectionIconResolver({
    listLibraries: async () => { listCalls += 1; return libs; },
    toLink: (thumb, serverUrl) => `P(${new URL(thumb, serverUrl)})`,
    fetchImpl,
  });
  return { resolve, calls, listCalls: () => listCalls };
}

describe("createCollectionIconResolver", () => {
  it("finds the first matching collection across libraries", async () => {
    const h = harness();
    assert.equal(await h.resolve(["Marvel"]), "P(http://plex-a.test:32400/library/collections/11/thumb)");
    assert.equal(await h.resolve(["Bond"]), "P(http://plex-b.test:32400/library/collections/77/thumb)");
    assert.equal(await h.resolve(["Nope"]), null);
    assert.equal(await h.resolve([]), null);
  });

  it("fetches each library once however many channels ask, concurrently or not", async () => {
    const h = harness();
    const names = Array.from({ length: 30 }, (_, i) => [i % 2 ? "Bond" : "Nope"]);
    await Promise.all(names.map((n) => h.resolve(n)));
    await h.resolve(["Marvel"]);
    assert.equal(h.calls.length, 3);
    assert.equal(new Set(h.calls).size, 3);
    assert.equal(h.listCalls(), 1);
  });

  it("skips a library that fails and keeps looking", async () => {
    const h = harness("http://plex-a.test:32400/library/sections/1/collections");
    assert.equal(await h.resolve(["Marvel"]), null);
    assert.equal(await h.resolve(["Bond"]), "P(http://plex-b.test:32400/library/collections/77/thumb)");
  });

  it("keeps looking when toLink declines or throws", async () => {
    const resolve = createCollectionIconResolver({
      listLibraries: async () => libs,
      toLink: (thumb) => {
        if (thumb.includes("/77/")) return "ok";
        if (thumb.includes("/11/")) throw new Error("bad");
        return null;
      },
      fetchImpl: (async (url: string) => ({ ok: true, json: async () => ({ MediaContainer: { Directory: [...(dirs[url] ?? []), { title: "Marvel", thumb: "/library/collections/77/thumb" }] } }) })) as unknown as typeof fetch,
    });
    assert.equal(await resolve(["Marvel"]), "ok");
  });
});
