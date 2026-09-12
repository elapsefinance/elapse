# `examples/lambda` requires AWS and is exempt from the clone-and-run guarantee

2026-09-12 · Decided by Furqaan · Status: accepted

## Context

Every example under `examples/` has, until now, met one bar set for the surface in [examples-frd.md](../specs/examples-frd.md): a judge clones it, pastes two Elapse keys, runs one command, and it works — and CI (FR-EXM-031) runs the whole path with **no external services and no chain**. That bar is what makes the examples credible as "integrate in an afternoon" proof.

The second example, `examples/lambda` (per-second serverless compute, [FRD](../specs/examples-lambda-frd.md)), executes subscriber-submitted code on **real AWS Lambda**. Furqaan's call in the 2026-09-12 grill was that the compute must be genuinely real, not a local sandbox — the demo is "your code runs on real serverless, billed by the second." Real Lambda needs an AWS account, credentials, and a deployed runner, none of which a cloning judge has and none of which CI can use without secrets. So this example cannot meet the clone-and-run bar without faking the very thing it exists to show.

Options weighed in the grill: (A) a pluggable executor defaulting to a local sandbox so clone-and-run survives, AWS optional; (B) AWS-only, documented prerequisites, looser bar; (C) drop AWS, keep a real local JS sandbox. Furqaan chose (B).

## Decision

`examples/lambda` **requires AWS** and is a **deliberate exception** to the examples surface's zero-setup clone-and-run guarantee. Specifically:

- It documents AWS prerequisites (account, credentials, a deployed runner) and is positioned as the **advanced** example, not the first a judge runs. `examples/saas` remains the zero-setup one.
- Its CI (FR-EXM-151) exercises only the **Elapse** path, with the Lambda executor **mocked** — AWS is never called in CI, and there is still no chain in CI.
- The real executor (`awsRunner`) is always used in production/demo; the `mockRunner` is a **test/CI seam only**, not a user-facing "local mode" (the pluggable-default of option A was rejected — a half-real example muddies the demo).
- The runner infrastructure was provisioned live during the grill in account `598046560354`, `us-east-1`: function `elapse-lambda-runner` (`nodejs20.x`, 5s timeout, 128MB) and role `elapse-lambda-runner-role` (only `AWSLambdaBasicExecutionRole` — CloudWatch logs, no other AWS access).

## Consequences

- **The surface bar is no longer uniform.** "Clone, two keys, one command, CI with no external services" now describes `examples/saas` and any future zero-setup example, but not `examples/lambda`. Anyone citing the guarantee must exclude this one. The examples FRD and this example's FRD both say so.
- **Security surface is real and bounded, not eliminated.** The runner executes arbitrary submitted JS inside AWS's per-invocation microVM with a zero-value IAM role, a 5s timeout, 128MB, and a server-side 20-runs/UTC-day cap. A Lambda outside a VPC still has outbound internet, so the README states plainly this is a demo runner, not a hardened sandbox for hostile users. Reserved concurrency could not be pinned to 1 (the account's total concurrency limit is 10); the daily-run cap is therefore the primary cost guard.
- **A judge who wants to run it must set up AWS.** That is accepted: the payoff is a demo where the metered thing is genuinely running, which `examples/saas` cannot show.
- **AWS billing risk sits with the account owner**, bounded by the caps above to within the AWS free tier at the documented limits.
- This ADR is linked from [examples-lambda-frd.md](../specs/examples-lambda-frd.md) (Undecided 1) and does not change `examples/saas` or its signed FRD.
