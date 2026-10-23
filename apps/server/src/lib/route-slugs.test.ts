import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Next.js refuses to route at all when two sibling folders use different
// dynamic slug names (e.g. [file] and [pass]). The type check doesn't catch it.
test("sibling dynamic route folders share one slug name", () => {
  const root = join(__dirname, "..", "app");
  const problems: string[] = [];
  const walk = (dir: string) => {
    const kids = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
    const slugs = new Set(kids.filter((n) => /^\[[^.\]][^\]]*\]$/.test(n)));
    if (slugs.size > 1) problems.push(`${dir}: ${[...slugs].join(", ")}`);
    for (const k of kids) walk(join(dir, k));
  };
  walk(root);
  assert.deepEqual(problems, []);
});
