import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Equivalence on a throwaway SQLite file with the real schema: the single-read overlap
// removal must delete exactly the rows the old one-query-per-new-programme loop deleted.
const dir = mkdtempSync(path.join(tmpdir(), "tfs-overlap-"));
process.env.DATABASE_URL = `file:${path.join(dir, "t.db")}`;
let prisma: typeof import("./prisma").prisma;
let removeOverlappingPrograms: typeof import("./remove-overlapping-programs").removeOverlappingPrograms;

before(async () => {
  execFileSync("npx", ["prisma", "db", "push", "--schema", "./prisma/schema", "--skip-generate"], {
    cwd: path.resolve(__dirname, "../.."),
    env: process.env,
    stdio: "ignore",
  });
  ({ prisma } = await import("./prisma"));
  ({ removeOverlappingPrograms } = await import("./remove-overlapping-programs"));
});
after(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

type Win = { startTime: Date; duration: number };

// The previous ProgrammingService.removeOverlappingPrograms, verbatim apart from `db`.
async function oldRemove(db: typeof prisma, channelId: string, programs: Win[]) {
  for (const program of programs) {
    const programStart = program.startTime.getTime();
    const programEnd = programStart + program.duration;
    const overlappingPrograms = await db.program.findMany({
      where: {
        channelId,
        OR: [
          { AND: [{ startTime: { gte: new Date(programStart) } }, { startTime: { lt: new Date(programEnd) } }] },
          { AND: [{ startTime: { lt: new Date(programStart) } }] },
        ],
      },
      select: { id: true, startTime: true, duration: true },
    });
    const actualOverlaps = overlappingPrograms.filter((existing) => {
      const existingStart = existing.startTime.getTime();
      const existingEnd = existingStart + existing.duration;
      return programStart < existingEnd && programEnd > existingStart;
    });
    if (actualOverlaps.length > 0) {
      await db.program.deleteMany({ where: { id: { in: actualOverlaps.map((p) => p.id) } } });
    }
  }
}

function counting() {
  const stats = { reads: 0, rows: 0 };
  const db = prisma.$extends({
    query: {
      program: {
        async findMany({ args, query }) {
          stats.reads++;
          const r = await query(args);
          stats.rows += r.length;
          return r;
        },
      },
    },
  }) as unknown as typeof prisma;
  return { db, stats };
}

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 1);

// History of back-to-back programmes, plus a few odd rows around the new window's edges.
async function seed(channelId: string, history: number, odd: boolean) {
  const rows: Array<{ channelId: string; startTime: Date; duration: number }> = [];
  for (let i = 0; i < history; i++) rows.push({ channelId, startTime: new Date(T0 + i * 25 * MIN), duration: 25 * MIN });
  const edge = T0 + history * 25 * MIN; // new programmes start here
  if (odd) {
    rows.push({ channelId, startTime: new Date(edge - 10 * MIN), duration: 30 * MIN }); // straddles the start
    rows.push({ channelId, startTime: new Date(edge - 10 * MIN), duration: 10 * MIN }); // ends exactly at start: kept
    rows.push({ channelId, startTime: new Date(edge + 7 * MIN), duration: 3 * MIN }); // inside
    rows.push({ channelId, startTime: new Date(edge + 7 * MIN), duration: 0 }); // zero-length inside
    rows.push({ channelId, startTime: new Date(edge - 3 * 60 * MIN), duration: 6 * 60 * MIN }); // long, from far back
    rows.push({ channelId, startTime: new Date(edge + 400 * 25 * MIN), duration: 5 * MIN }); // after the window: kept
  }
  await prisma.program.createMany({ data: rows });
  return edge;
}

function newPrograms(edge: number, n: number, gapEvery = 0): Win[] {
  const out: Win[] = [];
  let t = edge;
  for (let i = 0; i < n; i++) {
    out.push({ startTime: new Date(t), duration: 25 * MIN });
    t += 25 * MIN + (gapEvery && i % gapEvery === 0 ? 40 * MIN : 0);
  }
  return out;
}

async function remaining(channelId: string) {
  const rows = await prisma.program.findMany({ where: { channelId }, select: { startTime: true, duration: true }, orderBy: [{ startTime: "asc" }, { duration: "asc" }] });
  return rows.map((r) => `${r.startTime.getTime()}+${r.duration}`);
}

for (const [label, history, n, gapEvery] of [
  ["contiguous window", 60, 40, 0],
  ["window with gaps", 60, 40, 3],
  ["empty history", 0, 10, 0],
] as const) {
  test(`same rows deleted as the per-programme loop (${label})`, async () => {
    const a = await prisma.channel.create({ data: { number: 1000 + history + n + gapEvery, name: `old-${label}` } });
    const b = await prisma.channel.create({ data: { number: 2000 + history + n + gapEvery, name: `new-${label}` } });
    const edgeA = await seed(a.id, history, true);
    const edgeB = await seed(b.id, history, true);
    await oldRemove(prisma, a.id, newPrograms(edgeA, n, gapEvery));
    await removeOverlappingPrograms(b.id, newPrograms(edgeB, n, gapEvery), prisma);
    assert.deepEqual(await remaining(b.id), await remaining(a.id));
    assert.ok((await remaining(a.id)).length >= history); // history before the window survives
  });
}

test("one read instead of one per new programme (7-day guide over 7 days of catch-up)", async () => {
  const history = 400; // ~7 days of 25-minute programmes
  const n = 400;
  const a = await prisma.channel.create({ data: { number: 5001, name: "old-perf" } });
  const b = await prisma.channel.create({ data: { number: 5002, name: "new-perf" } });
  const edgeA = await seed(a.id, history, true);
  const edgeB = await seed(b.id, history, true);

  const oldC = counting();
  let t = performance.now();
  await oldRemove(oldC.db, a.id, newPrograms(edgeA, n));
  const oldMs = performance.now() - t;

  const newC = counting();
  t = performance.now();
  await removeOverlappingPrograms(b.id, newPrograms(edgeB, n), newC.db);
  const newMs = performance.now() - t;

  console.log(`overlap removal, ${n} new over ${history} history: old ${oldC.stats.reads} reads / ${oldC.stats.rows} rows / ${oldMs.toFixed(0)} ms; new ${newC.stats.reads} reads / ${newC.stats.rows} rows / ${newMs.toFixed(0)} ms`);
  assert.equal(newC.stats.reads, 1);
  assert.equal(oldC.stats.reads, n);
  assert.deepEqual(await remaining(b.id), await remaining(a.id));
});
