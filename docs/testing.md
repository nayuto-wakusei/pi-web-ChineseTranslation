# Testing policy

Test PI WEB's decisions and contracts. Trust frameworks, browsers, and dependencies to do their jobs; test our integration with them where it can fail.

## Keep useful protection

- Cover logic, state transitions, validation, permissions, durable writes, cancellation, cleanup, and compatibility contracts.
- Assert observable results: returned data, state changes, emitted requests/events, or durable effects.
- Keep regressions when their triggering conditions remain possible. A fixed bug is not an obsolete test.
- Use UI tests for meaningful interaction and state. Use real browsers when our composition can break hit targeting, clipping, anchoring, or focus.

## Avoid low-value tests

- Exact UI wording, markup structure, class lists, pixel values, or source spelling unless the value itself is a functional contract. Commands, encoded URLs, protocol fields, and escaping can be contracts; incidental copy usually is not.
- Re-testing dependency behavior, such as syntax-highlighter token choices or whether a CSS declaration produces its stated size.
- Duplicate scenarios or validation matrices repeated at multiple layers. Give each invariant one primary owner; broader tests should prove wiring.
- Assertions that only exercise their own fixtures, mocks, or a helper that mirrors rather than drives production behavior.
- Regressions for removed features or unreachable paths, and tests added only to increase coverage numbers.

## Choose the smallest useful boundary

Before adding or retaining a test, answer:

1. What meaningful failure does it catch in current production behavior?
2. What protection does it add beyond existing tests, delivery checks, or reliable normal usage?
3. Could a smaller test prove the same invariant with less setup and brittleness?

Prefer pure logic, then controller/service, route, component, and broader integration tests as needed. Use real processes or browsers when their interaction is the contract. Ordinary compilation belongs to typecheck/build; packaging belongs to delivery checks. Explicit public API compatibility tests can protect contracts beyond ordinary compilation.

Prefer updating existing coverage to adding cases. Consolidate overlapping tests and remove obsolete ones when the current contract supports it; a change does not automatically require a new test. Add coverage only for a meaningful gap, not as a formal completion ritual.

Keep fixtures small, deterministic, isolated, and representative of the real boundary. Investigate failures; do not remove or weaken useful protection merely to make checks pass.

For implementation mechanics, read [test harnesses](testing-harnesses.md). For commands and verification scope, read [development and delivery checks](development-checks.md).
