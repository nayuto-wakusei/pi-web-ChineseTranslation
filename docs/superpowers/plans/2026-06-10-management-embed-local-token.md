# Management Embed Local Token Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pi-web management embed remote introspection with locally verified HMAC entry tokens and 24-hour server-side management sessions.

**Architecture:** `pi-web` keeps the existing route contract through `managementContextForRequest(...)`, but that function first checks an HttpOnly management session cookie and only verifies a short-lived entry token when no valid session exists. The platform backend keeps the authorization decision, builds the full pi-web management context from already scoped project visibility, and signs it with `DIFY_SHARED_SECRET` using the existing `base64url(payload).base64url(hmac)` pattern.

**Tech Stack:** TypeScript, Fastify, Node crypto, Vitest in `D:\dev\pi-web`; TypeScript, node:test, Node crypto in `D:\dev\dify\AI-platform-backend`.

---

### Task 1: pi-web Local Token Core

**Files:**
- Modify: `D:\dev\pi-web\src\server\managementEmbed.test.ts`
- Modify: `D:\dev\pi-web\src\server\managementEmbed.ts`

- [ ] **Step 1: Add failing tests for local token verification**

Add tests covering valid HMAC token, tampering, expiry, issuer mismatch, audience mismatch, and session reuse after entry token expiry. Test helpers should sign payloads with `createHmac("sha256", secret).update(encodedPayload).digest("base64url")`.

- [ ] **Step 2: Run red test**

Run: `npm test -- src/server/managementEmbed.test.ts`

Expected: tests fail because local token verification/session APIs do not exist yet.

- [ ] **Step 3: Implement local verification and in-memory session store**

Update `ManagementEmbedRuntime` so it can read/write sessions through explicit methods, parse `sharedSecretEnv`, `issuer`, and `audience`, verify entry token signatures, validate `iat/exp/iss/aud`, parse the embedded context, generate high-entropy session ids, and expire sessions after 24 hours.

- [ ] **Step 4: Run green test**

Run: `npm test -- src/server/managementEmbed.test.ts`

Expected: all management embed tests pass.

### Task 2: pi-web HTTP Cookie Integration

**Files:**
- Modify: `D:\dev\pi-web\src\server\app.test.ts`
- Modify: `D:\dev\pi-web\src\server\managementEmbed.ts`

- [ ] **Step 1: Add failing app-level tests**

Add a test that enters management mode with a valid signed token, asserts `/api/projects` returns the synthesized project and sets an HttpOnly session cookie, then repeats `/api/projects` with only that cookie and an expired token in the URL to prove the cookie wins.

- [ ] **Step 2: Run red app test**

Run: `npm test -- src/server/app.test.ts --testNamePattern "management"`

Expected: the new cookie persistence test fails before route integration is complete.

- [ ] **Step 3: Wire cookie read/write through `managementContextForRequest`**

Use Fastify request/reply APIs already available at route call sites where possible; keep call sites stable by allowing `managementContextForRequest(request, runtime)` to use request cookies and set-cookie state through Fastify raw reply hooks if needed. Keep cookie name dedicated to management sessions and path scoped to `/`.

- [ ] **Step 4: Run green app test**

Run: `npm test -- src/server/app.test.ts --testNamePattern "management"`

Expected: management app tests pass.

### Task 3: pi-web Config Contract

**Files:**
- Modify: `D:\dev\pi-web\src\shared\apiTypes.ts`
- Modify: `D:\dev\pi-web\src\config.ts`
- Modify: `D:\dev\pi-web\src\server\configRoutes.ts`
- Modify: `D:\dev\pi-web\src\config.test.ts`
- Modify: `D:\dev\pi-web\src\server\configRoutes.test.ts`

- [ ] **Step 1: Add failing config tests**

Add tests showing `managementEmbed.auth.sharedSecretEnv`, `issuer`, and `audience` are accepted, and old introspection-only values are no longer required for enabled management mode.

- [ ] **Step 2: Run red config tests**

Run: `npm test -- src/config.test.ts src/server/configRoutes.test.ts`

Expected: tests fail because parsers still use `introspectionUrl/serviceSecretEnv`.

- [ ] **Step 3: Update config types and parsers**

Replace auth shape with `sharedSecretEnv?: string`, `issuer?: string`, and `audience?: string`. Preserve unrelated config behavior.

- [ ] **Step 4: Run green config tests**

Run: `npm test -- src/config.test.ts src/server/configRoutes.test.ts`

Expected: config tests pass.

### Task 4: Backend Local Token Issuance

**Files:**
- Modify: `D:\dev\dify\AI-platform-backend\src\integrations\dify.test.ts`
- Modify: `D:\dev\dify\AI-platform-backend\src\integrations\dify.ts`
- Modify: `D:\dev\dify\AI-platform-backend\src\http\routes\dify.ts`

- [ ] **Step 1: Add failing backend tests**

Replace the `launchPiWebEmbed forwards workspace id` test with assertions that `launchPiWebEmbed` returns a signed token without calling `fetch`, carries `iss/aud/iat/exp/jti/user/projects/tools/sandbox`, uses a 5-minute `exp`, and limits projects to the selected workspace when provided.

- [ ] **Step 2: Run red backend test**

Run: `npm test -- src/integrations/dify.test.ts`

Expected: tests fail because `launchPiWebEmbed` still calls the Dify external portal API.

- [ ] **Step 3: Implement backend token construction**

Change `launchPiWebEmbed` to accept scoped projects, build the management context payload locally, sign it with `config.dify.sharedSecret`, and return `{ token, expiresAt }`.

- [ ] **Step 4: Update route call**

Pass the already scoped `projects` list from `/api/dify/pi-web/launch` into `launchPiWebEmbed` after existing workspace authorization checks.

- [ ] **Step 5: Run green backend test**

Run: `npm test -- src/integrations/dify.test.ts`

Expected: integration tests pass.

### Task 5: Release Note Fragment and Verification

**Files:**
- Create: `D:\dev\pi-web\.changeset\<unique-name>.md`

- [ ] **Step 1: Add patch changeset**

Add a user-facing changeset explaining that management embed no longer requires pi-web to call back to the platform and now keeps a 24-hour server-side management session.

- [ ] **Step 2: Run pi-web verification**

Run: `npm run typecheck`
Run: `npm run lint`
Run: `npm test -- src/server/managementEmbed.test.ts src/server/app.test.ts src/config.test.ts src/server/configRoutes.test.ts`

Expected: all commands pass.

- [ ] **Step 3: Run backend verification**

Run in `D:\dev\dify\AI-platform-backend`: `npm run typecheck`
Run in `D:\dev\dify\AI-platform-backend`: `npm test -- src/integrations/dify.test.ts`

Expected: both commands pass.

