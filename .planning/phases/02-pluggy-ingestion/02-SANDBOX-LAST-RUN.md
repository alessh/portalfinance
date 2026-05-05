---
last_success_at: never
run_id: pending
trigger: pending
---

# Pluggy Sandbox Last Successful Run

This file records the last time the real-Pluggy-sandbox e2e gate
(`tests/e2e/pluggy/sandbox-connect.spec.ts`) ran green.

Until automated CI is wired in, the developer who runs the spec manually
should overwrite this file with timestamp + observed metrics so the
project has a verifiable trail of when the 60-second criterion last
passed against real Pluggy infrastructure.

Runbook: `docs/ops/pluggy-sandbox-gate.md`.
