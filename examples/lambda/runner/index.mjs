/**
 * Elapse example — Lambda "runner".
 * Executes subscriber-submitted JavaScript inside the Lambda microVM and
 * returns the result. The isolation boundary is AWS Lambda itself plus a
 * zero-value execution role; this is a DEMO runner, not a hardened sandbox
 * for hostile users (a Lambda outside a VPC still has outbound internet).
 *
 * Event:  { code: string }   // the body of an async function; use `return`
 * Reply:  { ok, result|error, ms, logs }
 */
export const handler = async (event) => {
  const code = typeof event?.code === "string" ? event.code : "";
  const started = Date.now();
  const logs = [];
  const sandboxConsole = { log: (...a) => logs.push(a.map(String).join(" ")) };
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("console", `"use strict"; return (async () => { ${code} })();`);
    const result = await fn(sandboxConsole);
    return { ok: true, result: result === undefined ? null : result, ms: Date.now() - started, logs };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e), ms: Date.now() - started, logs };
  }
};
