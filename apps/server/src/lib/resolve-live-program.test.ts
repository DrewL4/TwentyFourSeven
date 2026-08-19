import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickScheduledProgram } from "./resolve-live-program";

function program(id: string, startMs: number, durationMs: number) {
  return { id, startTime: new Date(startMs), duration: durationMs };
}

describe("pickScheduledProgram", () => {
  const t0 = 1_000_000;
  const hour = 60 * 60 * 1000;
  const ep1 = program("ep1", t0, hour);
  const ep2 = program("ep2", t0 + hour, hour);
  const ep3 = program("ep3", t0 + 2 * hour, hour);

  it("picks the overlapping program at now", () => {
    const picked = pickScheduledProgram([ep1, ep2, ep3], new Date(t0 + 10 * 60 * 1000));
    assert.equal(picked?.id, "ep1");
  });

  it("picks the later overlapping row at the exact boundary", () => {
    const picked = pickScheduledProgram([ep1, ep2, ep3], new Date(t0 + hour));
    assert.equal(picked?.id, "ep2");
  });

  it("skips a finished file and starts the next episode immediately", () => {
    const stillInEp1Window = new Date(t0 + 40 * 60 * 1000);
    const picked = pickScheduledProgram([ep1, ep2, ep3], stillInEp1Window, {
      skipProgramId: "ep1",
    });
    assert.equal(picked?.id, "ep2");
  });

  it("uses the next upcoming row when nothing is on now", () => {
    const gap = new Date(t0 - 5 * 60 * 1000);
    const picked = pickScheduledProgram([ep1, ep2], gap);
    assert.equal(picked?.id, "ep1");
  });

  it("returns null when the schedule is empty", () => {
    assert.equal(pickScheduledProgram([], new Date(t0)), null);
  });
});
