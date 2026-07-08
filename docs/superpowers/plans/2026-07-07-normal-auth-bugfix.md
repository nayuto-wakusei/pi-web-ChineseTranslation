# Normal Auth Bugfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the normal-mode password gate regressions without changing management embed behavior or session daemon code.

**Architecture:** Keep normal-mode browser access protected by the existing HttpOnly session cookie, and let server-to-server requests authenticate by sending the configured ordinary-mode password as `Authorization: Bearer <password>`. Preserve `normalAuth` in config writes that do not explicitly manage it, and reject malformed password hashes at config boundaries so users do not get soft-locked behind an impossible login.

**Tech Stack:** TypeScript, Fastify hooks/routes, Vitest, existing PI WEB config parser and machine client.

---

## File Structure

- Modify `src/server/normalAuth.ts`: allow the normal auth gate to verify bearer credentials against `normalAuth.passwordHash`.
- Modify `src/server/app.test.ts`: add regression tests for bearer-password API access and config preservation.
- Modify `src/server/normalAuth.test.ts`: add WebSocket bearer-token coverage.
- Modify `src/shared/piWebConfigParsing.ts`: validate `normalAuth.passwordHash` format instead of only checking non-empty string.
- Modify `src/config.ts`: preserve existing `normalAuth` when incoming config omits it.
- Modify `src/config.test.ts`: update expectations and add malformed-hash rejection coverage.

Do not touch `src/server/sessiond.ts` or the session daemon protocol.

---

### Task 1: Preserve `normalAuth` On Partial Config Saves

**Files:**
- Modify: `src/config.ts`
- Test: `src/config.test.ts`

- [ ] **Step 1: Write the failing config preservation test**

Add this test near the existing `savePiWebConfig` merge tests in `src/config.test.ts`:

```ts
it("preserves normalAuth when saving settings that do not include it", async () => {
  await writeFile(configPath, `${JSON.stringify({
    normalAuth: { passwordHash: "pbkdf2-sha256$120000$c2FsdA$ZmFrZS1oYXNo" },
    future: { enabled: true },
  }, null, 2)}\n`, "utf8");

  savePiWebConfig({ port: 9000, allowedHosts: [] }, testOptions());

  expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
    future: { enabled: true },
    normalAuth: { passwordHash: "pbkdf2-sha256$120000$c2FsdA$ZmFrZS1oYXNo" },
    port: 9000,
    allowedHosts: [],
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: the new test fails because `normalAuth` is removed when the incoming config omits it.

- [ ] **Step 3: Implement minimal preservation logic**

In `src/config.ts`, replace the unconditional delete with only deleting `normalAuth` when the caller explicitly includes it:

```ts
  const incoming = piWebConfigRecord(normalized);
  delete existing["host"];
  delete existing["port"];
  delete existing["allowedHosts"];
  delete existing["shortcuts"];
  delete existing["plugins"];
  if ("normalAuth" in incoming) delete existing["normalAuth"];
  delete existing["managementEmbed"];
  delete existing["pathAccess"];
  delete existing["uploads"];
  delete existing["maxUploadBytes"];
  delete existing["spawnSessions"];
  delete existing["subsessions"];
  const merged = { ...existing, ...incoming };
```

Keep the existing behavior for all other managed keys.

- [ ] **Step 4: Run the focused config tests**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: all `src/config.test.ts` tests pass.

---

### Task 2: Reject Malformed `normalAuth.passwordHash`

**Files:**
- Modify: `src/shared/piWebConfigParsing.ts`
- Test: `src/config.test.ts`

- [ ] **Step 1: Write failing malformed-hash tests**

Replace or extend the empty-password-hash test in `src/config.test.ts` with:

```ts
it("rejects empty and malformed normalAuth password hashes", async () => {
  await writeFile(configPath, `${JSON.stringify({ normalAuth: { passwordHash: "" } }, null, 2)}\n`, "utf8");
  expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config normalAuth.passwordHash must use pbkdf2-sha256 format");

  await writeFile(configPath, `${JSON.stringify({ normalAuth: { passwordHash: "not-a-real-hash" } }, null, 2)}\n`, "utf8");
  expect(() => loadPiWebConfig(testOptions())).toThrow("PI WEB config normalAuth.passwordHash must use pbkdf2-sha256 format");
});
```

- [ ] **Step 2: Run the focused test and confirm malformed hash currently passes**

Run:

```bash
npm test -- src/config.test.ts
```

Expected: the malformed hash assertion fails until parser validation is added.

- [ ] **Step 3: Add hash-format validation in the shared parser**

In `src/shared/piWebConfigParsing.ts`, add a helper near `parseNormalAuth`:

```ts
function parseNormalAuthPasswordHash(value: unknown, context: ParseContext): string {
  const passwordHash = parseString(value, "normalAuth.passwordHash", context);
  const [algorithm, iterationsValue, saltValue, hashValue, extra] = passwordHash.split("$");
  const iterations = Number(iterationsValue);
  if (
    algorithm !== "pbkdf2-sha256"
    || extra !== undefined
    || !Number.isInteger(iterations)
    || iterations < 1
    || saltValue === undefined
    || hashValue === undefined
    || !isBase64Url(saltValue)
    || !isBase64Url(hashValue)
  ) {
    throw new Error(error(context, "normalAuth.passwordHash must use pbkdf2-sha256 format"));
  }
  return passwordHash;
}

function isBase64Url(value: string): boolean {
  return value !== "" && /^[A-Za-z0-9_-]+$/u.test(value);
}
```

Then update `parseNormalAuth`:

```ts
function parseNormalAuth(value: unknown, context: ParseContext): NonNullable<PiWebConfigValues["normalAuth"]> {
  if (!isRecord(value) || Array.isArray(value)) throw new Error(error(context, "normalAuth must be an object"));
  return {
    ...(value["passwordHash"] === undefined ? {} : { passwordHash: parseNormalAuthPasswordHash(value["passwordHash"], context) }),
  };
}
```

- [ ] **Step 4: Run parser/config tests**

Run:

```bash
npm test -- src/config.test.ts src/client/src/api/parsers.test.ts
```

Expected: all tests pass. Client API parser remains permissive because it parses server responses, not config file writes.

---

### Task 3: Let Bearer Passwords Pass The Normal Auth Gate

**Files:**
- Modify: `src/server/normalAuth.ts`
- Test: `src/server/app.test.ts`

- [ ] **Step 1: Add app regression test for bearer password access**

In `src/server/app.test.ts`, add:

```ts
it("allows ordinary mode API requests with the configured password as a bearer token", async () => {
  piWebConfig = { normalAuth: { passwordHash: testPasswordHash("secret-pass") } };

  const wrongBearerResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer wrong-pass", cookie: "" } });
  const bearerResponse = await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: "Bearer secret-pass", cookie: "" } });

  expect(wrongBearerResponse.statusCode).toBe(401);
  expect(bearerResponse.statusCode).toBe(200);
  expect(bearerResponse.json()).toEqual([]);
});
```

- [ ] **Step 2: Implement bearer password verification**

In `src/server/normalAuth.ts`, update `authorize` to accept `authorizationHeader`, parse `Bearer <value>`, and call the existing PBKDF2 verifier against the configured password hash. Cookie sessions still win first, and missing password hash still returns `setup-required`.

- [ ] **Step 3: Run focused server tests**

Run:

```bash
npm test -- src/server/app.test.ts
```

Expected: all tests pass.

---

### Task 4: Cover Bearer Tokens For WebSockets

**Files:**
- Modify: `src/server/normalAuth.test.ts`

- [ ] **Step 1: Add a WebSocket bearer-token test**

Add to `src/server/normalAuth.test.ts`:

```ts
it("allows websocket clients with an authorized bearer token", async () => {
  registerNormalModeAuthGate(app, auth, {
    await app.inject({ method: "POST", url: "/api/normal-auth/setup", payload: { password: "secret-pass" } });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const socket = new WebSocket(`${serverUrl(app)}/api/test-socket`, {
    headers: { authorization: "Bearer secret-pass" },
  });
  const ready = nextMessage(socket);

  await waitForOpen(socket);
  await expect(ready).resolves.toBe("ready");
  socket.close();
});
```

If the current `beforeEach` already registers the gate, move gate registration into each test or rebuild the test app in a helper so each test can pass different gate options.

- [ ] **Step 2: Run the WebSocket test file**

Run:

```bash
npm test -- src/server/normalAuth.test.ts
```

Expected: unauthenticated WebSocket still gets 401, cookie-authenticated WebSocket opens, bearer-token WebSocket opens.

---

### Task 5: Final Verification

**Files:**
- No additional code files.

- [ ] **Step 1: Run targeted normal-auth regression set**

Run:

```bash
npm test -- src/config.test.ts src/server/app.test.ts src/server/normalAuth.test.ts src/client/src/api/clients.test.ts src/client/src/api/parsers.test.ts src/client/src/components/settings/settingsConfigDraft.test.ts src/client/src/components/NormalAuthDialog.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exits 0.

- [ ] **Step 3: Run full verification**

Run:

```bash
npm run verify
```

Expected: exits 0 locally.

- [ ] **Step 4: Manual smoke on Ubuntu after deploy**

Use the existing deployment flow for `192.168.1.162`, then verify:

```bash
curl -i http://127.0.0.1:8504/api/projects
```

Expected without cookie: `401`.

```bash
curl -i -H 'Authorization: Bearer <ordinary-mode-password>' http://127.0.0.1:8504/api/projects
```

Expected with the configured ordinary-mode password: `200`.

Also verify in browser:

- `http://192.168.1.162:8504` shows login when password is configured.
- Login succeeds with the configured password.
- Changing password keeps the current browser logged in and invalidates the old password.

---

## Self-Review

- Spec coverage: fixes the three reviewed defects: remote machine bearer compatibility, accidental password hash deletion, and malformed hash soft-lock.
- Scope: no changes to `src/server/sessiond.ts`, session daemon protocol, or management embed session model.
- Risk: bearer-token bypass only applies when the bearer value matches the configured ordinary-mode password hash. Browser ordinary-mode access still uses the HttpOnly cookie.
