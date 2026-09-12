# `examples/lambda` (per-second serverless compute) — FRD

Status: **Signed 2026-09-12 (Furqaan)** · Surface: Reference merchant (Node server + real AWS Lambda, terminal + console page) · Sources: detailed doc §4.2, §5.1–§5.3, §6, §7 step 5, §10; [examples-frd.md](./examples-frd.md) (the saas example this parallels); [ADR 2026-09-06 example merchant own brand](../decisions/2026-09-06-example-merchant-own-brand.md); [ADR 2026-09-04 subscriber permit](../decisions/2026-09-04-subscriber-permit-relayer-signs.md); [ADR 2026-09-05 keeper may cancel](../decisions/2026-09-05-keeper-may-cancel.md). Grilled 2026-09-12 (Furqaan); AWS runner infra provisioned live during the grill.

## Problem

`examples/saas` proves the smallest correct Elapse merchant, but its product is faked — "Acme GPU" gives you no GPU. Judges asking "can Elapse bill *real* usage of a *real* thing by the second?" want a second example where the metered product is genuinely running. Serverless compute is the sharpest demo of Elapse's core claim ("you only pay what elapsed"): a subscriber opens a live compute session, runs code on **real AWS Lambda**, and pays only the seconds the session was open — the session starting and ending on its own, and the merchant's server hearing about the end through a **webhook, not a cron job**.

This example deliberately trades the saas example's clone-and-run guarantee for realism: it requires an AWS account and a deployed runner (see Undecided 1). It is the "advanced" reference, not the first thing a judge runs.

## Non-negotiable framing (settled in the grill)

- **The subscription IS the session.** Elapse bills a running meter, never per invocation. The meter runs wall-clock from start to cancel; a subscriber pays for the seconds their session is **open**, regardless of how many times they invoke or how long each invocation takes.
- **Two clocks, never confused.** AWS bills the *merchant* per invocation-millisecond; Elapse bills the *subscriber* by the open session. The merchant's margin is `(session rate/s) − (AWS cost)`. The example prints both so the model is legible.
- **The live meter is an estimate; the billed amount is exact from settlement.** The console meter ticks client-side (`rate × elapsed`) as a preview. The amount the subscriber actually pays is the settled figure delivered in `subscription.canceled` (`seconds_elapsed`, `amount_settled`); the console shows that once the session ends.
- **No per-invocation webhooks, ever.** Lifecycle events only, exactly as the platform guarantees.
- **No chain words on the subscriber side.** The console and copy say "session", "seconds", "$". Never a token, address, or tx.
- **The session starts and ends automatically; there is no Start button and no Stop button.** The one irreducible gesture is the subscriber's permit authorization (Face ID) — consent to be charged, which cannot be removed. It is triggered inline by the subscriber's first Run. The session then ends on its own: on leaving, on inactivity, or at the escrow cap — with no action from the subscriber. Auto-end is server-initiated `subscriptions.cancel` (keeper-may-cancel ADR); the escrow cap is the hard on-chain backstop.

## User stories

1. As a judge, I want to just write code and hit Run and have the session begin by itself (one Face ID), so that I never think about "starting" a meter.
2. As a judge, I want the meter to keep ticking while I sit idle between runs, so that I understand I pay for the open session, not per invocation.
3. As a judge, I want the session to end by itself when I close the tab or walk away, so that I stop paying without doing anything.
4. As a judge, I want the server to learn the session ended via a webhook and refuse the next run, so that I see there is no cron job.
5. As a subscriber, I want to see the exact amount I was billed when the session ends, not just the ticking estimate, so that I trust the meter.
6. As a subscriber, I want a hard ceiling on what a session can ever cost me even if everything fails, so that a stuck session cannot drain me.
7. As a merchant engineer, I want to see how a metered live session maps onto Elapse (first run → checkout → active → auto-cancel → revoke), so that I can build my own metered-compute product.
8. As a merchant engineer, I want the smallest correct webhook handler (raw body, `constructEvent`, dedupe, 2xx fast), so that I can copy it, identical to the saas example.
9. As a security reviewer, I want the runner's isolation, its zero-value IAM role, and its residual risks stated plainly, so that I understand what is and is not safe.
10. As the account owner, I want a hard daily cap on executions, so that a runaway or abusive session cannot run up an AWS bill.
11. As a demo presenter, I want a branded console with a code box, a Run button, output, and a live meter (no Start/Stop buttons), so that the video shows "write code, it runs, walk away, it stops."
12. As the account owner, I want one documented path to provision and to tear down the AWS runner, so that I can reproduce or remove it.

## Functional requirements

### Setup and run

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-100 | `examples/lambda` is a standalone Node 20+ TypeScript project (run via `tsx`) depending on the **published** `@elapse/sdk` pinned `^0.1.0` plus `@aws-sdk/client-lambda` and `dotenv`; server on `node:http` (raw webhook body, no framework). It is **not** held to `examples/saas`'s zero-setup clone-and-run bar: it documents AWS prerequisites (Undecided 1). | `npm install && npm start` succeeds with valid env; missing AWS access fails with a readable message, not a stack trace. |
| FR-EXM-101 | `.env.example` lists `ELAPSE_SECRET_KEY`, `ELAPSE_WEBHOOK_SECRET`, `ELAPSE_API_URL`, `PORT=3000`, `BASE_URL=http://localhost:3000`, `AWS_REGION=us-east-1`, `LAMBDA_FN=elapse-lambda-runner`, `DAILY_RUN_LIMIT=20`, `MAX_DURATION_SECONDS=3600`, `IDLE_TIMEOUT_SECONDS=60`, `HEARTBEAT_STALE_SECONDS=15`, each with one comment on where it comes from. AWS credentials are **not** in `.env`; the standard AWS SDK credential chain is used. Missing `ELAPSE_SECRET_KEY`, `ELAPSE_API_URL`, or `LAMBDA_FN` exits 1 naming the variable. | Config loader unit test; exit code asserted per missing var. |
| FR-EXM-102 | `npm start` (a) creates or reuses a Product `"Serverless runtime"` at `"0.002"` USD/s (reuse by name via `products.list`), (b) prints `Product`, `Webhooks`, and `Runner: {LAMBDA_FN} @ {AWS_REGION}`, (c) listens on `PORT`. Checkout sessions are created per subscriber on demand at first Run (FR-EXM-114), not at boot. | Mock API + mock Lambda run asserts the product body (§4.2) and stdout snapshot. |
| FR-EXM-103 | The README has sections in this order: What this is · Prerequisites (incl. AWS) · Provision the runner · Run it · What you will see · How the session maps to Elapse · Security · Files · Teardown. Every non-AWS command is exercised by CI (FR-EXM-151). | README lint: headings snapshot; commands runnable. |

### Console (subscriber surface) — no Start/Stop buttons

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-110 | `GET /` serves the merchant's own-brand landing (one HTML file + shared CSS, no framework, per the own-brand ADR): name, "Serverless runtime", "$0.002 / second · ~$7.20 / hour", and an **Open console →** link (navigation only; it starts no billing). | Playwright: link points to `/console`. |
| FR-EXM-111 | `GET /console` serves the workspace: a code textarea, a single **Run** button posting to `/run`, an output panel, and a **live meter** ticking client-side from `rate × (now − started_at)` at 100ms, tabular numerals, no blinking (meter copy rules). Before the first Run the meter reads `00:00 · $0.00` and is not charging. There is **no Start button and no Stop button**. When the session has ended it shows the exact settled receipt "Session ended · paid {seconds_elapsed}s · ${paid}" (from FR-EXM-113, not the estimate) and the next Run silently begins a new session. No chain words. | Route + Playwright: idle, running, ended states; no Start/Stop control present; ended figure equals the settled value, not the ticking estimate. |
| FR-EXM-112 | `GET /cancel` shows "Checkout canceled. Nothing was charged." (the hosted-checkout cancel URL). | Route test. |
| FR-EXM-113 | `GET /access/:sub_id` returns `{ active, reason, seconds_elapsed?, paid_usd? }` JSON — the "is this session running, and if ended what did it cost" check. `paid_usd` is the subscriber-facing gross (`seconds_elapsed × rate`), not the merchant's net-of-fee `amount_settled`. | Unit test before/after a canceled Event; `paid_usd` computed as gross. |

### Automatic start (first Run)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-114 | On a `/run` with no active session for the viewer, the server does **not** execute; it creates a Checkout session (`successUrl = {BASE_URL}/console?session={cs}`, `cancelUrl = {BASE_URL}/cancel`) with `maxDurationSeconds = MAX_DURATION_SECONDS` and returns `409 { needs_start: true, checkout_url }`. The console stashes the pending code and redirects to `checkout_url` (the one Face ID / permit). On return to `/console?session={cs}`, the console resolves the `sub_id` (polls `/access` until active) and **auto-runs the stashed code**. The subscriber experiences one Run click plus Face ID; the meter starts at checkout completion. | Integration with mock API: first run → 409 + checkout_url; after a simulated completed session, the stashed code runs; no second Run click needed. |
| FR-EXM-115 | The meter starts when the permit-backed stream starts (platform `start`, ADR 2026-09-04), never before. The console's client-side meter reads `started_at` from the active session so it matches the on-chain start. | Meter start time equals the session's `started_at`, not the page-load time. |

### Automatic end (leave / idle / cap)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-116 | While `/console` is open with an active session it POSTs `/heartbeat?sub={sub}` every `5s`; the server records `last_seen`. A `/run` also refreshes `last_seen` and `last_run`. | Heartbeat updates `last_seen`; asserted in a unit test. |
| FR-EXM-117 | A server sweep (every 5s) auto-ends any active session by calling `subscriptions.cancel` when either `now − last_seen > HEARTBEAT_STALE_SECONDS` (viewer left / tab closed / network gone) or `now − last_run > IDLE_TIMEOUT_SECONDS` (viewer idle with tab open). It logs `auto-ended (left)` or `auto-ended (idle)`. Because `cancel` is eventual (SDK: the `canceled` status arrives via webhook once the chain confirms), the sweep sets a `canceling` flag on the session after the call so it does **not** re-issue `cancel` on later ticks; the `subscription.canceled` webhook is what flips the session inactive (FR-EXM-131). | Unit tests with injected clock: stale `last_seen` → one `cancel` call with reason left; idle `last_run` → one `cancel` call with reason idle; a second sweep before the webhook does not re-call; active-and-recent → no cancel. |
| FR-EXM-118 | On `pagehide`/`beforeunload` the console fires `navigator.sendBeacon('/end?sub={sub}')`; the server cancels that session immediately (does not wait for the sweep), also setting `canceling`. | Beacon to `/end` → one `subscriptions.cancel` for that sub. |
| FR-EXM-119 | The escrow cap is the hard backstop: because first-Run checkout sets `maxDurationSeconds`, the permit caps `max_escrow = rate × MAX_DURATION_SECONDS`, and the meter ends itself on-chain at the cap (platform FR-CON-041, surfaced as `ended_reason: "cap_reached"`) even if the server and every auto-end path fail. The README states the resulting ceiling (default 1h → ~$7.20). No example code beyond passing `maxDurationSeconds`. | README states the cap ceiling; the checkout body carries `maxDurationSeconds`. |

### Runner / executor

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-120 | `POST /run?sub={sub_id}` with `{ code }`: if no active session → FR-EXM-114 (409 needs_start); else if the daily limit is reached → 429 (FR-EXM-140); else invoke the AWS runner and return its result `{ ok, result / error, ms, logs }`. The daily-limit and active checks run before any AWS call. | Tests: no session → 409; active + mock runner → 200; over limit → 429 with no runner call. |
| FR-EXM-121 | The executor is a **deep module**, one interface `run(code: string): Promise<RunResult>`, two implementations: `awsRunner` (real, `@aws-sdk/client-lambda` `InvokeCommand` on `LAMBDA_FN`) and `mockRunner` (deterministic, no network, tests/CI). The real runner is default; the mock is a test/CI seam only (internal `LAMBDA_RUNNER_MODE=mock`), not a user option (the pluggable-default was rejected in the grill; the example is AWS-only). | Unit tests on both against the same interface; `awsRunner` with the SDK client mocked. |
| FR-EXM-122 | The runner Lambda (`runner/index.mjs`, shipped) receives `{ code }`, executes it as an async function body, returns `{ ok, result, ms, logs }` (or `{ ok:false, error, ms, logs }` on throw), capturing `console.log`; `undefined` serializes as `null`. | The committed runner returns 4 for `return 2+2` and captures a logged line (proven live 2026-09-12). |
| FR-EXM-123 | Invocation errors (throttle, timeout, function error) map to a readable `/run` response, never a raw AWS stack; a Lambda timeout surfaces as `{ ok:false, error:"execution timed out" }`. | Test with the SDK client mocked to throw each case. |
| FR-EXM-124 | `Provision the runner` documents the runner exactly as provisioned 2026-09-12: IAM role `elapse-lambda-runner-role` trusting `lambda.amazonaws.com` with **only** `AWSLambdaBasicExecutionRole` (CloudWatch logs; no other AWS access), and function `elapse-lambda-runner` (`nodejs20.x`, **5s timeout, 128MB**), in `us-east-1`. A `Teardown` section documents deleting both. Lambda's native START/END/REPORT lines in CloudWatch Logs are noted as where to see real invocations — observability only, off the billing path. | README has the exact CLI; a reviewer can reproduce and remove the infra. |

### Webhook handler and session gating

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-130 | `POST /webhooks` reads the **raw** body and calls `elapse.webhooks.constructEvent(rawBody, header, ELAPSE_WEBHOOK_SECRET)`; mirrors saas FR-EXM-020..025 (verify before act, 400 on bad signature, respond 2xx within 100ms before work, dedupe on `evt_` id). It keeps an in-memory session map `sub_ → { active, canceling, customer, started_at, last_seen, last_run, seconds_elapsed?, paid_usd?, updated_at }`. | Tests: raw-body pass, tampered/expired → 400, redelivery → no-op. |
| FR-EXM-131 | Lifecycle from §5.1: `checkout.session.completed` → log `provision session`; `subscription.created` → `active=true`, record `started_at`, log `session open sub_…`; `subscription.updated` → log `sync session (status)`; `subscription.canceled` → `active=false`, `canceling=false`, record `seconds_elapsed` and `paid_usd` (gross), log `session closed · {seconds_elapsed}s · ${paid_usd}`; `invoice.settled` → log `book revenue ${amount_settled}`; `invoice.payment_failed` → `active=false`, log `session closed (payment failed)`. Unknown → `ignored`. | One test per type asserts the map and the exact log line. |
| FR-EXM-132 | After `subscription.canceled` or `invoice.payment_failed`, the next `/run` for that `sub_id` returns 409 needs_start (a fresh session), and `/heartbeat`/`/end` for it are no-ops — the webhook, not a timer, is the source of truth for "closed". | Integration: run OK while active; signed canceled; run → 409 needs_start. |

### Rate limit (cost guard)

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-140 | The server enforces a hard `DAILY_RUN_LIMIT` **(default 20) executions per UTC day** across all sessions. A run beyond it returns `429 {"error":"daily execution limit reached"}` and is **not** sent to AWS. Resets at UTC midnight. Primary AWS-cost guard; it exists because account-level reserved concurrency could not be set (Open). | Unit test: 20 pass, 21st → 429 with no runner call; resets on a new UTC day (clock injected). |
| FR-EXM-141 | The runner's caps are defence in depth: 5s timeout and 128MB bound each invocation; the account's concurrency ceiling bounds fan-out. README states expected cost is within the AWS free tier. | README states the cost bound and the caps. |

### Demo readiness and CI

| Id | Requirement | Acceptance |
| --- | --- | --- |
| FR-EXM-150 | `npm run demo:check` sends a locally-signed `subscription.canceled` to `/webhooks` and exits 0 only if the server logs `session closed`, mirroring saas FR-EXM-030. | Script exit-code test. |
| FR-EXM-151 | CI runs the Elapse path against a local API and worker with the **mock runner** (no AWS, no chain): product created, a session opened via a delivered event, a `/run` served by the mock while active, an idle sweep (injected clock) or a signed `subscription.canceled` closing the session, and `/run` then returning needs_start — under 2 minutes. AWS is never called in CI. | GitHub Actions job green on relevant PRs and nightly. |

## Business rules

| Id | Rule |
| --- | --- |
| BR-EXM-100 | Every Elapse call goes through `@elapse/sdk`, frozen methods only (BR-SDK-001); no hand-written `fetch` to the platform. |
| BR-EXM-101 | Always verify before acting; no code path touches the session map without a successfully constructed Event. |
| BR-EXM-102 | Respond 2xx first, work second; the handler never awaits merchant logic before responding. |
| BR-EXM-103 | Idempotent on `evt_` id; a redelivered Event is a no-op. |
| BR-EXM-104 | `@aws-sdk/client-lambda` is the **one** dependency allowed beyond the saas set (`@elapse/sdk`, `tsx`, `dotenv`), justified because real Lambda is the point of this example. No framework. |
| BR-EXM-105 | AWS credentials come only from the standard SDK chain, never from `.env` and never logged. The runner's IAM role carries logs-only access and nothing else. |
| BR-EXM-106 | Money and rates are decimal strings; the subscriber receipt is `seconds_elapsed × rate` (gross paid), computed with decimal-safe math, never `parseFloat`. |
| BR-EXM-107 | No chain vocabulary in the landing, console, or logs. Subscriber copy is "session", "seconds", "$". |
| BR-EXM-108 | The example never runs submitted code in its own process; execution happens only inside the AWS Lambda runner. |
| BR-EXM-109 | The daily execution limit is checked before any AWS call, so the cost guard cannot be bypassed by an invocation error path. |
| BR-EXM-110 | Auto-end is always server-initiated `subscriptions.cancel` (keeper-may-cancel ADR), issued at most once per session (the `canceling` guard). The escrow cap (`maxDurationSeconds`) is the on-chain backstop; the client can hasten end (beacon) but is never trusted to be the only thing that ends a session. |

## Interfaces

```
examples/lambda/
  README.md              FR-EXM-103 (incl. Provision, Security, Teardown)
  .env.example           FR-EXM-101
  package.json           scripts: start, demo:check, test, typecheck
  src/index.ts           boot: product, http server; routes / , /console, /cancel, /access/:id, /run, /heartbeat, /end, /webhooks
  src/executor.ts        deep module: run(code) -> RunResult; awsRunner + mockRunner (FR-EXM-121)
  src/session.ts         session map + evt_ dedupe + daily counter + idle/stale sweep (FR-EXM-116/117/130/140)
  src/webhooks.ts        // region:verify … // region:handle
  runner/index.mjs       the deployed AWS Lambda runner (FR-EXM-122) — already live
  public/{index,console,cancel}.html + brand CSS   FR-EXM-110/111/112

RunResult = { ok: true, result: unknown, ms: number, logs: string[] }
          | { ok: false, error: string, ms: number, logs: string[] }
```

Live AWS runner (provisioned 2026-09-12, account 598046560354, `us-east-1`): function `elapse-lambda-runner` (`arn:aws:lambda:us-east-1:598046560354:function:elapse-lambda-runner`), role `elapse-lambda-runner-role` (AWSLambdaBasicExecutionRole only), 5s / 128MB.

Example terminal:

```
$ npm start
Product:  prod_…  Serverless runtime  $0.002/s
Webhooks: POST http://localhost:3000/webhooks
Runner:   elapse-lambda-runner @ us-east-1

14:02:11  evt_…  subscription.created   → session open sub_…
14:02:19  ▶ run sub_…  return 2+2  → 4  (9ms)   [1/20 today]
14:03:20  ⏹ auto-ended (idle) sub_…
14:03:21  evt_…  subscription.canceled  → session closed · 62s · $0.12
14:03:25  ▶ run sub_…  → 409 needs_start
```

## Undecided (human) — all resolved at sign-off 2026-09-12

1. ~~**AWS-only positioning.**~~ **Accepted.** This example requires AWS and is a deliberate exception to the saas clone-and-run bar, recorded in [ADR 2026-09-12 examples/lambda AWS-only](../decisions/2026-09-12-examples-lambda-aws-only.md).
2. ~~**Product name / rate.**~~ **Accepted:** `"Serverless runtime"` at `"0.002"` USD/s.
3. ~~**Auto-lifecycle windows.**~~ **Accepted:** first-Run start; auto-end via heartbeat 5s + stale reap 15s + idle-since-run 60s + beacon on close; escrow cap 3600s (~$7.20) as backstop.
4. ~~**Executor selection.**~~ **Accepted:** real `awsRunner` in production; `mockRunner` is a test/CI seam only.
5. ~~**Receipt figure.**~~ **Accepted:** subscriber sees gross paid (`seconds_elapsed × rate`), not the net-of-fee amount.

## Open

- **Reserved concurrency could not be set to 1**: this AWS account's total concurrency limit is 10, and any reservation drops unreserved below AWS's minimum of 10. The daily-run limit (FR-EXM-140) is the primary cost guard; 5s/128MB and the account ceiling are defence in depth. Revisit if the limit is raised.
- **CloudWatch is off the money path by decision.** It was considered for auto-end and rejected: it cannot reach `localhost`, alarms lag minutes (overcharging the tail), and would add an inbound public endpoint. Auto-end is the server sweep + beacon; the cap is the guarantee. CloudWatch remains only as native invocation logs for the demo.
- Publish the example as a standalone GitHub template repo, as noted for saas.
- Live-streaming Lambda logs to the console is out of scope for v1 (single request/response).

## Revision

| Date | Who | Change |
| --- | --- | --- |
| 2026-09-12 | Claude (for Furqaan) | First draft from the 2026-09-12 grill: AWS-only per-second serverless-compute example; live compute session billed wall-clock; runner executes subscriber-submitted JS on real AWS Lambda (infra provisioned live: `elapse-lambda-runner`, logs-only role, 5s/128MB, us-east-1); saas-style entitlement/webhook gating; 20/UTC-day run limit as the cost guard; `node:http`; deps = saas set + `@aws-sdk/client-lambda`. |
| 2026-09-12 | Claude (for Furqaan) | Auto-lifecycle + billing clarity from the grill: no Start/Stop buttons; first Run starts the session (one inline Face ID, FR-EXM-114/115); auto-end via heartbeat + stale reap + idle timeout + tab-close beacon with server-initiated `subscriptions.cancel` guarded by a `canceling` flag (FR-EXM-116..118, BR-EXM-110); escrow cap as on-chain backstop (FR-EXM-119); the console shows the exact settled receipt (gross paid), not the estimate (framing, FR-EXM-111/113/131). CloudWatch rejected as the end trigger (Open). SDK `subscriptions.cancel` verified against the frozen source. Awaiting Furqaan's sign-off. |
| 2026-09-12 | Furqaan | **Signed.** All five Undecided items accepted at the recommended defaults; AWS-only exception recorded as [ADR 2026-09-12](../decisions/2026-09-12-examples-lambda-aws-only.md). Build may start. |
