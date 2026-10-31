# Test harnesses

Read this when implementing tests or helpers. [Testing policy](testing.md) decides what deserves coverage; [development and delivery checks](development-checks.md) owns verification commands.

## Helpers and boundaries

- Prefer explicit fixtures and injected collaborators. Fake the filesystem, network, clock, or process boundary needed by the scenario, not the unit under test.
- Prefer controllable promises and fake timers over sleeps. Clean up timers, globals, storage, DOM, and pending work.
- Keep helpers local until reuse is clear, then consolidate deliberately. Type fakes strictly; reserve `any` for intentionally untyped external boundaries.
- A pure helper must drive production behavior, not reproduce it solely for a test.
- Compare existing filesystem locations using `realpath()` on both sides. Compare raw paths only when their spelling is the contract.

## Lit component tests

Use an existing pure production seam for logic. For rendered state and event wiring, interact with a mounted component through its public properties and DOM. Do not introduce a mirror of the template just to make assertions easier.

### happy-dom

Opt in per test file with this first line; keep the default Vitest environment as Node:

```ts
// @vitest-environment happy-dom
```

Set public properties, append the component to `document.body`, and use real DOM events. Await `element.updateComplete` after changes; await it again when `updated()` schedules a follow-up render.

In `afterEach`, clear DOM and storage with `document.body.replaceChildren()` and `localStorage.clear()`, and restore stubs/timers. Test native control state, focus, accessibility wiring, and calls caused by interaction—not Lit internals.

happy-dom cannot prove layout, clipping, scroll geometry, or painting. Stub missing browser APIs at the boundary and assert our calls, not simulated geometry.

### Real browsers

Use the isolated fixtures under `test-fixtures/browser/` for browser-dependent composition. Fixtures must reproduce relevant containing blocks, shadow roots, scroll containers, and modality. For example, completion positioning needs the full-height application shadow host, not an editor mounted as the outermost host.

Keep hit-target and focus assertions meaningful. Forced clicks, arbitrary sleeps, and larger timeouts are not fixes for incorrect composition or fixtures.

### TemplateResult handler extraction

Prefer pure logic or happy-dom. Direct handler extraction is acceptable only for narrow template event wiring when a mounted DOM test would require disproportionate setup. Explain that tradeoff in a short comment.

Use the type-guarded helpers in `src/client/src/templateInspection.testSupport.ts`, anchor lookups to stable semantic markers, and assert the resulting component/controller effect. Do not inspect template strings/values to test general content, ordering, styling, focus, keyboard navigation, or accessibility. Do not copy new ad hoc inspection helpers.
