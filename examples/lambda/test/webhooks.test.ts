import { describe, expect, it } from "vitest";
import { grossUsd, handleWebhook } from "../src/webhooks";
import { createSessionStore } from "../src/session";
import { canceled, created, sign } from "./sign";

const SECRET = "whsec_test";
const deps = (sessions = createSessionStore({ dailyRunLimit: 20 })) => ({
  secret: SECRET,
  sessions,
  log: () => {},
  now: () => Date.UTC(2026, 8, 12, 10, 0, 0),
  logJson: false,
});

describe("FR-EXM-130 verify before act", () => {
  it("rejects a tampered body with 400 and changes no session", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const body = created();
    const signature = sign(body, SECRET);
    const res = handleWebhook(body.replace("sub_4QeABC", "sub_EVIL"), signature, deps(sessions));
    expect(res.status).toBe(400);
    expect(sessions.isActive("sub_EVIL")).toBe(false);
    expect(sessions.isActive("sub_4QeABC")).toBe(false);
  });
});

describe("FR-EXM-131 session lifecycle", () => {
  it("opens the session on subscription.created", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines: string[] = [];
    const body = created();
    const res = handleWebhook(body, sign(body, SECRET), { ...deps(sessions), log: (l) => lines.push(l) });
    expect(res.status).toBe(200);
    res.work!();
    expect(sessions.isActive("sub_4QeABC")).toBe(true);
    expect(lines[0]).toContain("session open sub_4QeABC");
  });
});

describe("FR-EXM-131 exact settled receipt", () => {
  it("closes on canceled and records the exact gross paid, displayed to two decimals", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines: string[] = [];
    const open = created();
    handleWebhook(open, sign(open, SECRET), { ...deps(sessions), log: () => {} }).work!();

    const body = canceled({}, "evt_close");
    handleWebhook(body, sign(body, SECRET), { ...deps(sessions), log: (l) => lines.push(l) }).work!();

    expect(sessions.isActive("sub_4QeABC")).toBe(false);
    // rate 0.002 x 62s = 0.124 exactly; shown as $0.12
    expect(sessions.get("sub_4QeABC")).toMatchObject({ secondsElapsed: 62, paidUsd: "0.124" });
    expect(lines[0]).toContain("session closed · 62s · $0.12");
  });

  it("BR-EXM-106 multiplies the rate as a decimal string, never a float", () => {
    expect(grossUsd("0.002", 62)).toBe("0.124");
    expect(grossUsd("0.004", 83)).toBe("0.332");
    expect(grossUsd("0.1", 3)).toBe("0.3"); // 0.1*3 = 0.30000000000000004 in float
  });
});

describe("BR-EXM-103 redelivery", () => {
  it("treats a redelivered event as a no-op", () => {
    const sessions = createSessionStore({ dailyRunLimit: 20 });
    const lines: string[] = [];
    const body = created();
    const d = { ...deps(sessions), log: (l: string) => lines.push(l) };
    handleWebhook(body, sign(body, SECRET), d).work!();
    handleWebhook(body, sign(body, SECRET), d).work!();
    expect(lines.filter((l) => l.includes("session open"))).toHaveLength(1);
    expect(lines.some((l) => l.startsWith("↺ duplicate"))).toBe(true);
  });
});
