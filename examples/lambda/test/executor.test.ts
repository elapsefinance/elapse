import { describe, expect, it } from "vitest";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import { awsRunner, mockRunner } from "../src/executor";

describe("FR-EXM-121 mockRunner", () => {
  it("returns a deterministic ok result without touching the network", async () => {
    const r1 = await mockRunner().run("return 2+2");
    const r2 = await mockRunner().run("return 2+2");
    expect(r1.ok).toBe(true);
    expect(r1).toEqual(r2);
    expect(typeof r1.ms).toBe("number");
    expect(Array.isArray(r1.logs)).toBe(true);
  });
});

describe("FR-EXM-121 awsRunner", () => {
  it("invokes the named function with the code and returns the parsed result", async () => {
    let seen: InvokeCommand["input"] | undefined;
    const client = {
      async send(command: InvokeCommand) {
        seen = command.input;
        const body = { ok: true, result: 4, ms: 9, logs: ["hi"] };
        return { StatusCode: 200, Payload: new TextEncoder().encode(JSON.stringify(body)) };
      },
    };
    const r = await awsRunner({ client, fnName: "elapse-lambda-runner" }).run("return 2+2");
    expect(seen?.FunctionName).toBe("elapse-lambda-runner");
    expect(JSON.parse(new TextDecoder().decode(seen!.Payload as Uint8Array))).toEqual({ code: "return 2+2" });
    expect(r).toEqual({ ok: true, result: 4, ms: 9, logs: ["hi"] });
  });
});

describe("FR-EXM-123 awsRunner errors", () => {
  it("maps a Lambda timeout to a readable error", async () => {
    const client = {
      async send() {
        const errBody = { errorType: "Unhandled", errorMessage: "2026-09-12T00:00:00Z Task timed out after 5.00 seconds" };
        return { StatusCode: 200, FunctionError: "Unhandled", Payload: new TextEncoder().encode(JSON.stringify(errBody)) };
      },
    };
    const r = await awsRunner({ client, fnName: "fn" }).run("while(true){}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("execution timed out");
  });

  it("maps a thrown SDK error to a readable message, never a raw stack", async () => {
    const client = {
      async send(): Promise<never> {
        throw Object.assign(new Error("Rate exceeded"), { name: "TooManyRequestsException" });
      },
    };
    const r = await awsRunner({ client, fnName: "fn" }).run("return 1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/rate|too many|busy/i);
      expect(r.error).not.toMatch(/\bat \//); // no stack frames
    }
  });
});
