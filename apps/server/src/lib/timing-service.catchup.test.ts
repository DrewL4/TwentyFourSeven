import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TimingService } from "./timing-service";

const channel = { catchupEnabled: true, catchupWindowHours: 24 };

describe("TimingService catchup helpers", () => {
  it("calculateCatchupWindow returns rolling window ending at now", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const { start, end } = TimingService.calculateCatchupWindow(channel, now);
    assert.equal(end.getTime(), now.getTime());
    assert.equal(start.toISOString(), "2026-05-18T12:00:00.000Z");
  });

  it("isProgramCatchupAvailable rejects future programs", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const program = {
      startTime: new Date("2026-05-19T13:00:00.000Z"),
      duration: 60 * 60 * 1000,
      catchupAvailable: true,
    };
    assert.equal(
      TimingService.isProgramCatchupAvailable(program, channel, now),
      false,
    );
  });

  it("isProgramCatchupAvailable accepts ended program inside window", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const program = {
      startTime: new Date("2026-05-19T10:00:00.000Z"),
      duration: 60 * 60 * 1000,
      catchupAvailable: true,
    };
    assert.equal(
      TimingService.isProgramCatchupAvailable(program, channel, now),
      true,
    );
  });

  it("isProgramCatchupAvailable rejects when catchupExpiry passed", () => {
    const now = new Date("2026-05-19T12:00:00.000Z");
    const program = {
      startTime: new Date("2026-05-17T10:00:00.000Z"),
      duration: 60 * 60 * 1000,
      catchupAvailable: true,
      catchupExpiry: new Date("2026-05-18T12:00:00.000Z"),
    };
    assert.equal(
      TimingService.isProgramCatchupAvailable(program, channel, now),
      false,
    );
  });

  it("getCatchupSeekOffset clamps mid-program requests", () => {
    const program = {
      startTime: new Date("2026-05-19T10:00:00.000Z"),
      duration: 2 * 60 * 60 * 1000,
    };
    const requested = new Date("2026-05-19T11:30:00.000Z");
    const { seekOffsetMs, remainingMs } = TimingService.getCatchupSeekOffset(
      program,
      requested,
    );
    assert.equal(seekOffsetMs, 90 * 60 * 1000);
    assert.equal(remainingMs, 30 * 60 * 1000);
  });

  it("calculateCatchupExpiry extends from program end", () => {
    const programEnd = new Date("2026-05-19T13:00:00.000Z");
    const expiry = TimingService.calculateCatchupExpiry(programEnd, 24);
    assert.equal(expiry.toISOString(), "2026-05-20T13:00:00.000Z");
  });
});
