---
name: testing-guide
description: Repository testing policy and harness navigation. Use for planning, writing, reviewing, or triaging tests and test helpers.
---

# Testing guide

Read [testing policy](../../../docs/testing.md) before test work. Use [test harnesses](../../../docs/testing-harnesses.md) for mechanics and [development checks](../../../docs/development-checks.md) for commands, platform coverage, and delivery gates.

Keep policy and detailed conventions in those canonical pages. The project `/reassess-tests` prompt lives in [`.pi/prompts/reassess-tests.md`](../../../.pi/prompts/reassess-tests.md).

This fork retains `npm run verify:staged` in its pre-commit hook and requires `npm run verify` for cross-cutting work and before final merge review. Do not replace that policy with a whitespace-only hook.
