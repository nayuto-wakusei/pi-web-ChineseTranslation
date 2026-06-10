# Management Embed Local Token Design

## Goal

Replace remote management-embed introspection with local token verification in `pi-web`, while preserving the existing security boundary:

- the platform still decides who may open management embed
- `pi-web` still rejects forged or expired management access
- the `pi-web` host no longer needs reverse network connectivity back to the platform introspection endpoint

This design also preserves the new default-project behavior for users whose management context has no authorized projects.

## Problem

The current management embed flow requires this runtime path:

1. the platform launches `pi-web` with `/pi-web/?embed=management&token=...`
2. `pi-web` receives the token
3. `pi-web` calls `managementEmbed.auth.introspectionUrl`
4. the platform returns the management context

In the target deployment, the browser can reach the platform and the platform can proxy to `pi-web`, but the `pi-web` host cannot open a TCP connection back to the platform introspection endpoint. That makes management embed fail before project synthesis can run.

The deployment problem is structural, not a code bug. The design therefore removes the reverse callback entirely.

## Scope

This change covers:

- `pi-web` management-embed authentication and session establishment
- platform-side generation of the management-embed token
- short-lived entry token plus longer-lived server-side management session
- replacement of introspection-based configuration with local verification configuration

This change does not cover:

- real-time revocation of already issued management sessions
- distributed session storage across multiple `pi-web` processes
- migration compatibility for old introspection-mode deployments
- general user login or ordinary non-management `pi-web` behavior

## Requirements

### Functional

- The platform must still launch `pi-web` with an embed token.
- `pi-web` must validate the token locally without any outbound fetch.
- The token must carry the full management context needed by `pi-web`:
  - user identity
  - project authorization
  - tool restrictions
  - sandbox overrides
- If the authorized project list is empty, `pi-web` must keep synthesizing the default project under the configured project root.
- After successful first entry, `pi-web` must establish a management session that lasts 24 hours.
- Once the management session exists, the user must continue to use the current page even after the entry token expires.
- Refreshing or reopening within the 24-hour management session window must continue to work without requiring a new entry token, as long as the browser still has the session cookie.

### Security

- `pi-web` must reject tampered tokens.
- `pi-web` must reject expired entry tokens.
- `pi-web` must validate issuer and audience values.
- Management session identifiers must be high-entropy random values.
- The management session cookie must be `HttpOnly`.
- The management session must expire server-side after 24 hours.

### Operational

- The design must not require `pi-web` to contact the platform during request handling.
- The design must work with a single `pi-web` process using in-memory session storage.
- Restarting `pi-web` may invalidate all management sessions; this is acceptable.

## Chosen Approach

Use a self-contained HMAC-signed management token issued by the platform and verified locally by `pi-web`.

Why this approach:

- It removes the reverse network dependency completely.
- It preserves signature-based trust.
- It matches the existing backend style, which already signs external-portal payloads with a shared secret.
- It avoids introducing asymmetric key management or a JWT dependency that is unnecessary for this targeted fix.

Rejected alternatives:

- Keep introspection and fix networking. This does not solve the structural deployment constraint.
- Use unsigned or weakly trusted context from the browser. This weakens the trust boundary too much.
- Use asymmetric signing. This is valid but too large a change for the current problem.

## Token Format

The platform will issue a token using the existing `base64url(payload).base64url(hmac)` pattern.

Payload fields:

- `iss`
- `aud`
- `iat`
- `exp`
- `jti`
- `user`
- `projects`
- `tools`
- `sandbox`

The embedded management context must match the shape already consumed by `pi-web`:

- `user.id`
- `user.rootUserId`
- `user.roles`
- `user.permissions`
- `projects[]`
- optional `tools`
- optional `sandbox`

Token lifetime:

- entry token TTL: 5 minutes

This token is only for session establishment, not for every subsequent request.

## Management Session Model

After successful token verification, `pi-web` will create a server-side management session.

Session properties:

- lifetime: 24 hours
- storage: process-local in-memory store
- key: random opaque session id
- value:
  - management context
  - `createdAt`
  - `expiresAt`
  - `lastUsedAt`

Session transport:

- `pi-web` sets a dedicated management session cookie
- cookie must be `HttpOnly`
- cookie should be scoped to the `pi-web` app path
- cookie security flags should follow deployment requirements, but the design assumes at minimum `HttpOnly`

Session behavior:

1. request contains a valid management session cookie:
   - use the stored management context directly
2. request has no valid management session cookie but has `embed=management&token=...`:
   - verify the token
   - create a management session
   - set the cookie
   - continue the request using the decoded context
3. neither condition is true:
   - fall back to ordinary non-management `pi-web` behavior

This means the user can continue using an open or refreshed page during the 24-hour server-side session window without being interrupted by the 5-minute entry token expiry.

## `pi-web` Changes

### Authentication flow

`src/server/managementEmbed.ts` becomes the single place that:

- verifies signed management entry tokens locally
- creates and reads management sessions
- resolves the effective management context for a request

Remote `fetch()`-based introspection is removed from the runtime path.

### Configuration

The old config shape:

- `managementEmbed.auth.introspectionUrl`
- `managementEmbed.auth.serviceSecretEnv`

is replaced with a local-verification shape:

- `managementEmbed.auth.sharedSecretEnv`
- `managementEmbed.auth.issuer`
- `managementEmbed.auth.audience`

`sharedSecretEnv` defaults to `PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN`.

`issuer` and `audience` default values should match the platform defaults already used in the backend:

- issuer: `telecom-portal`
- audience: `dify-external-portal`

### Request handling contract

Existing route call sites should keep using `managementContextForRequest(...)`.

Its internal behavior changes from:

- parse token
- remote introspection

to:

- read management session cookie if present
- otherwise parse and verify entry token
- create management session if entry token succeeds

This keeps the route integration surface stable while changing only the authentication source.

## Platform Backend Changes

### Launch endpoint

`AI-platform-backend` continues to own the decision about who may access management embed.

`/api/dify/pi-web/launch` must stop depending on the Dify-side `pi-web/launch` endpoint for management context issuance.

Instead it must:

- resolve the actor's scoped project visibility using the existing organization and workspace scope logic
- construct the management context payload locally
- sign that payload with `DIFY_SHARED_SECRET`
- return the signed token to the frontend

This keeps the security boundary in the platform: `pi-web` still trusts only platform-signed data.

### Shared secret

The backend signing secret remains `DIFY_SHARED_SECRET`.

`pi-web` uses the same secret value under its own environment variable name:

- `PI_WEB_MANAGEMENT_EMBED_SERVICE_TOKEN`

These two values must remain identical in deployment.

## Frontend Impact

`AI-platform-fronted` does not need a behavior change for this design.

The existing flow already:

- requests a launch token from the platform
- opens `/pi-web/?embed=management&token=...`

That is still the correct entry path.

The browser bridge can remain responsible for forwarding management mode markers and token information during the initial bootstrap.

## Error Handling

Expected failure classes:

- missing token
- malformed token
- bad signature
- expired token
- wrong issuer
- wrong audience
- expired or missing management session after initial entry

User-facing behavior:

- invalid or expired entry token should return a 401-style management-auth error
- expired or missing management session should force re-entry through a fresh launch token
- ordinary non-management usage must continue to behave as before

The implementation should avoid leaking internal signing details in response bodies.

## Testing

Required `pi-web` tests:

- valid signed entry token creates a management session
- subsequent request with session cookie succeeds after entry token expiry
- tampered token is rejected
- expired token is rejected
- wrong issuer is rejected
- wrong audience is rejected
- empty project list still synthesizes the default project
- process-local session expiry after 24 hours is enforced

Required backend tests:

- launch endpoint emits a signed local-verification token
- token payload contains the expected management context fields
- token expiry is 5 minutes
- scoped projects in the payload match existing platform authorization rules

## Rollout

1. Implement backend token issuance.
2. Implement `pi-web` local verification and 24-hour management session support.
3. Update `pi-web` deployment config to use the shared-secret-based auth settings.
4. Verify management embed works even when the `pi-web` host cannot reach the old introspection endpoint.
5. Remove old introspection-specific deployment values from active configs after validation.

## Risks

- No real-time revocation: a valid 24-hour management session remains usable until expiry or process restart.
- Process-local session storage means sessions are lost on restart and do not scale across multiple `pi-web` processes.
- Any backend bug in payload construction can widen or narrow authorization incorrectly, so backend payload tests are security-critical.

These are acceptable tradeoffs for the stated goal and deployment constraints.

## Success Criteria

- Management embed works without any outbound introspection request from `pi-web`.
- The empty-project default-project flow still works.
- Users are not interrupted by 5-minute token expiry during an active workday session.
- A fresh browser entry still requires a valid, platform-signed management token.
