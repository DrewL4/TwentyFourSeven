import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The channel editor's actor/director/genre/studio autocomplete must return exactly
// what the old full-library scan did, and stop rescanning until the library changes.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-facets-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
let prisma: typeof import("./prisma").prisma;
let facets: typeof import("./library-facets");

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("./prisma"));
  facets = await import("./library-facets");
});
after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

type Field = "actors" | "directors" | "genres" | "studio";

// The removed router handlers, verbatim in behaviour.
async function oldAnswer(field: Field, search: string | undefined, limit: number) {
  const where = { [field]: { not: null } };
  const select = { [field]: true };
  const [m, s] = await Promise.all([
    prisma.mediaMovie.findMany({ where, select } as any),
    prisma.mediaShow.findMany({ where, select } as any),
  ]);
  const all = new Set<string>();
  [...m, ...s].forEach((item: any) => {
    const raw = item[field];
    if (field === "studio") {
      if (raw && raw.trim()) all.add(raw.trim());
      return;
    }
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) parsed.forEach((v) => { if (typeof v === "string" && v.trim()) all.add(v.trim()); });
      } catch {}
    }
  });
  let list = Array.from(all).sort();
  if (search && search.trim()) {
    const t = search.toLowerCase();
    list = list.filter((v) => v.toLowerCase().includes(t));
  }
  return list.slice(0, limit);
}

const odd = [null, "", "not json", '"just a string"', '[" Ann Lee ", 7, null, "", "ann lee"]', "[]", '{"a":1}'];

test("facet answers match the old scan, and the scan only reruns after a library change", async () => {
  const server = await prisma.mediaServer.create({ data: { name: "P", url: "http://plex", type: "PLEX" } });
  const lib = await prisma.mediaLibrary.create({ data: { serverId: server.id, key: "1", name: "L", type: "MOVIE" } });
  const people = (n: number, k: number) => JSON.stringify(Array.from({ length: k }, (_, j) => `Person ${(n * 7 + j) % 900}`));
  const movies = Array.from({ length: 1200 }, (_, n) => ({
    libraryId: lib.id, title: `M${n}`, ratingKey: `m${n}`, duration: 60_000,
    actors: n % 13 === 0 ? odd[n % odd.length] : people(n, 8),
    directors: n % 11 === 0 ? odd[(n + 3) % odd.length] : people(n + 1, 1),
    genres: n % 17 === 0 ? odd[(n + 5) % odd.length] : JSON.stringify(["Drama", "Comedy ", "Ünïcode", "drama"].slice(0, (n % 4) + 1)),
    studio: n % 9 === 0 ? (n % 2 ? "   " : null) : ` Studio ${n % 40} `,
  }));
  await prisma.mediaMovie.createMany({ data: movies });
  const shows = Array.from({ length: 300 }, (_, n) => ({
    libraryId: lib.id, title: `S${n}`, ratingKey: `s${n}`,
    actors: people(n + 5000, 12), directors: null, genres: '["Reality","Kids"]', studio: `Network ${n % 25}`,
  }));
  await prisma.mediaShow.createMany({ data: shows });

  const cases: [string | undefined, number][] = [[undefined, 50], ["", 200], ["   ", 200], ["person 1", 200], [" person", 200], ["ANN", 5], ["dra", 50], ["studio 3", 3], ["zzz", 50], [undefined, 0], [undefined, 100000]];
  for (const field of ["actors", "directors", "genres", "studio"] as Field[]) {
    for (const [search, limit] of cases) {
      assert.deepEqual(await facets.searchLibraryFacet(field, search, limit, prisma), await oldAnswer(field, search, limit), `${field} ${JSON.stringify(search)} ${limit}`);
    }
  }

  let scans = 0;
  const counted = prisma.$extends({
    query: {
      mediaMovie: { findMany: ({ args, query }) => { scans++; return query(args); } },
      mediaShow: { findMany: ({ args, query }) => { scans++; return query(args); } },
    },
  }) as unknown as typeof prisma;
  facets.clearLibraryFacetCache();
  await facets.searchLibraryFacet("actors", "p", 200, counted);
  assert.equal(scans, 2, "first call reads the library");
  for (const s of ["pe", "per", "pers", "perso"]) await facets.searchLibraryFacet("actors", s, 200, counted);
  assert.equal(scans, 2, "keystrokes reuse the parsed list");

  // An edit, an insert and a delete each show up on the next call.
  const m0 = await prisma.mediaMovie.findFirstOrThrow({ where: { title: "M1" } });
  await new Promise((r) => setTimeout(r, 5));
  await prisma.mediaMovie.update({ where: { id: m0.id }, data: { actors: '["Brand New Actor"]' } });
  assert.deepEqual(await facets.searchLibraryFacet("actors", "brand new", 10, counted), ["Brand New Actor"]);
  assert.equal(scans, 4);
  await prisma.mediaShow.create({ data: { libraryId: lib.id, title: "S-new", ratingKey: "snew", studio: "Fresh Network" } });
  assert.deepEqual(await facets.searchLibraryFacet("studio", "fresh", 10, counted), ["Fresh Network"]);
  await prisma.mediaShow.deleteMany({ where: { ratingKey: "snew" } });
  assert.deepEqual(await facets.searchLibraryFacet("studio", "fresh", 10, counted), []);
  for (const field of ["actors", "studio"] as Field[]) {
    assert.deepEqual(await facets.searchLibraryFacet(field, undefined, 100000, counted), await oldAnswer(field, undefined, 100000));
  }
});
