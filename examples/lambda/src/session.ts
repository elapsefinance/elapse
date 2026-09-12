/**
 * FR-EXM-116/117/130/140: the server's in-memory session state. Holds the session map,
 * deduplicates Events by `evt_` id, counts runs against a per-UTC-day cost cap, and decides
 * which sessions are due to be auto-ended. The actual `subscriptions.cancel` call and the
 * webhook that confirms it live in the server (BR-EXM-110); this module is pure state so it
 * tests without the SDK or a clock.
 */

export interface Session {
  active: boolean;
  canceling: boolean;
  customer?: string;
  startedAt?: number;
  lastSeen: number;
  lastRun: number;
  secondsElapsed?: number;
  paidUsd?: string;
  updatedAt: number;
}

const utcDay = (nowMs: number): number => Math.floor(nowMs / 86_400_000);

export function createSessionStore(opts: { dailyRunLimit: number }) {
  let runDay = -1;
  let runCount = 0;
  const seen = new Set<string>();
  const sessions = new Map<string, Session>();

  return {
    /** FR-EXM-140: consume one run against the UTC-day cap; false when the day is spent. */
    tryConsumeRun(nowMs: number): boolean {
      const day = utcDay(nowMs);
      if (day !== runDay) {
        runDay = day;
        runCount = 0;
      }
      if (runCount >= opts.dailyRunLimit) return false;
      runCount += 1;
      return true;
    },

    /** FR-EXM-130: true when this Event id was already handled (redelivery). Marks it seen. */
    seenEvent(evtId: string): boolean {
      if (seen.has(evtId)) return true;
      seen.add(evtId);
      return false;
    },

    get(sub: string): Session | undefined {
      return sessions.get(sub);
    },

    isActive(sub: string): boolean {
      return sessions.get(sub)?.active === true;
    },

    /** FR-EXM-131: `subscription.created` — the meter is running. */
    applyOpen(sub: string, info: { customer?: string; startedAt: number; nowMs: number }): void {
      const prev = sessions.get(sub);
      sessions.set(sub, {
        ...prev,
        active: true,
        canceling: false,
        ...(info.customer === undefined ? {} : { customer: info.customer }),
        startedAt: info.startedAt,
        lastSeen: info.nowMs,
        lastRun: info.nowMs,
        updatedAt: info.nowMs,
      });
    },

    /**
    7p * FR-EXM-116: record activity. Every console heartbeat refreshes presence (`lastSeen`);
     * only a Run also refreshes `lastRun`, which is what the idle timeout measures.
     */
    touch(sub: string, nowMs: number, opts?: { run?: boolean }): void {
      const prev = sessions.get(sub);
      if (!prev) return;
      sessions.set(sub, {
        ...prev,
        lastSeen: nowMs,
        lastRun: opts?.run ? nowMs : prev.lastRun,
        updatedAt: nowMs,
      });
    },

    /**
     * FR-EXM-117: which active sessions should be auto-ended now, and why. `left` means the
     * console stopped heartbeating (tab closed, network gone); `idle` means it is still there
     * but nothing has run. A session already `canceling` is skipped so `subscriptions.cancel`
     * is issued once per session while the chain confirms (BR-EXM-110).
     */
    dueForAutoEnd(nowMs: number, windows: { idleTimeoutMs: number; heartbeatStaleMs: number }): Array<{ sub: string; reason: "left" | "idle" }> {
      const due: Array<{ sub: string; reason: "left" | "idle" }> = [];
      for (const [sub, s] of sessions) {
        if (!s.active || s.canceling) continue;
        if (nowMs - s.lastSeen > windows.heartbeatStaleMs) due.push({ sub, reason: "left" });
        else if (nowMs - s.lastRun > windows.idleTimeoutMs) due.push({ sub, reason: "idle" });
      }
      return due;
    },

    /** FR-EXM-117/118: a cancel has been issued; do not issue another until the webhook lands. */
    markCanceling(sub: string): void {
      const prev = sessions.get(sub);
      if (prev) sessions.set(sub, { ...prev, canceling: true });
    },

    /** FR-EXM-131: `subscription.canceled` / `invoice.payment_failed` — the meter has stopped. */
    applyClosed(sub: string, info: { secondsElapsed?: number; paidUsd?: string; nowMs: number }): void {
      const prev = sessions.get(sub) ?? { lastSeen: info.nowMs, lastRun: info.nowMs };
      sessions.set(sub, {
        ...prev,
        active: false,
        canceling: false,
        ...(info.secondsElapsed === undefined ? {} : { secondsElapsed: info.secondsElapsed }),
        ...(info.paidUsd === undefined ? {} : { paidUsd: info.paidUsd }),
        updatedAt: info.nowMs,
      });
    },
  };
}
