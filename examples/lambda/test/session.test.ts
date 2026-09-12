import { describe, expect, it } from "vitest";
import { createSessionStore } from "../src/session";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 8, 12, 10, 0, 0); // 2026-09-12 10:00 UTC

describe("FR-EXM-140 daily run limit", () => {
  it("allows up to the limit per UTC day, then rejects, and resets next day", () => {
    const s = createSessionStore({ dailyRunLimit: 3 });
    expect(s.tryConsumeRun(t0)).toBe(true);
    expect(s.tryConsumeRun(t0)).toBe(true);
    expect(s.tryConsumeRun(t0)).toBe(true);
    expect(s.tryConsumeRun(t0)).toBe(false); // 4th same day
    expect(s.tryConsumeRun(t0 + DAY)).toBe(true); // next UTC day resets
  });
});

describe("FR-EXM-130 evt dedupe", () => {
  it("reports an event id unseen the first time and seen after", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    expect(s.seenEvent("evt_1")).toBe(false);
    expect(s.seenEvent("evt_1")).toBe(true);
    expect(s.seenEvent("evt_2")).toBe(false);
  });
});

describe("FR-EXM-131 session open and close", () => {
  it("opens on created and closes on canceled, recording the settled receipt", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    expect(s.isActive("sub_1")).toBe(false);

    s.applyOpen("sub_1", { customer: "cus_1", startedAt: t0, nowMs: t0 });
    expect(s.isActive("sub_1")).toBe(true);
    expect(s.get("sub_1")?.startedAt).toBe(t0);

    s.applyClosed("sub_1", { secondsElapsed: 62, paidUsd: "0.12", nowMs: t0 + 62_000 });
    expect(s.isActive("sub_1")).toBe(false);
    expect(s.get("sub_1")).toMatchObject({ active: false, canceling: false, secondsElapsed: 62, paidUsd: "0.12" });
  });
});

describe("FR-EXM-116 heartbeat and run activity", () => {
  it("a heartbeat refreshes presence only; a run refreshes presence and idle", () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    s.applyOpen("sub_1", { startedAt: t0, nowMs: t0 });

    s.touch("sub_1", t0 + 5_000); // heartbeat
    expect(s.get("sub_1")).toMatchObject({ lastSeen: t0 + 5_000, lastRun: t0 });

    s.touch("sub_1", t0 + 9_000, { run: true });
    expect(s.get("sub_1")).toMatchObject({ lastSeen: t0 + 9_000, lastRun: t0 + 9_000 });
  });
});

describe("FR-EXM-117 auto-end sweep", () => {
  const windows = { idleTimeoutMs: 60_000, heartbeatStaleMs: 15_000 };
  const now = t0 + 70_000;

  const store = () => {
    const s = createSessionStore({ dailyRunLimit: 20 });
    // left: opened, never heartbeat again
    s.applyOpen("sub_left", { startedAt: t0, nowMs: t0 });
    // idle: still heartbeating, but no Run since t0
    s.applyOpen("sub_idle", { startedAt: t0, nowMs: t0 });
    s.touch("sub_idle", now);
    // healthy: ran just now
    s.applyOpen("sub_ok", { startedAt: t0, nowMs: t0 });
    s.touch("sub_ok", now, { run: true });
    return s;
  };

  it("flags a vanished viewer as left and a present-but-inactive one as idle", () => {
    const due = store().dueForAutoEnd(now, windows);
    expect(due).toEqual(expect.arrayContaining([
      { sub: "sub_left", reason: "left" },
      { sub: "sub_idle", reason: "idle" },
    ]));
    expect(due.map((d) => d.sub)).not.toContain("sub_ok");
  });

  it("does not re-issue a cancel for a session already canceling", () => {
    const s = store();
    expect(s.dueForAutoEnd(now, windows).map((d) => d.sub)).toContain("sub_idle");
    s.markCanceling("sub_idle");
    expect(s.dueForAutoEnd(now, windows).map((d) => d.sub)).not.toContain("sub_idle");
  });
});
