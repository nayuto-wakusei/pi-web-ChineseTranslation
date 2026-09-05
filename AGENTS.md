# Agent Notes

This repository is the Chinese-localized fork of PI WEB. Preserve upstream functionality while keeping user-visible core and bundled-plugin copy in Chinese. Do not translate protocol identifiers, API fields, commands, paths, or runtime payloads unless they are explicitly mapped for display.

When committing, use the GitHub username as the author name and do not provide an email address.

## System model

PI WEB's core hierarchy is `Machine -> Project -> Workspace -> Session`:

- a machine is a local or federated PI WEB runtime;
- a project is a directory on that machine;
- a workspace is a git worktree, or the project directory for a non-git project;
- a session is a Pi Coding Agent conversation running in a workspace.

Keep machine identity in state, URLs, caches, sockets, and plugin registrations. A resource id from a remote machine is not globally unique by itself.

## Runtime ownership

This project is expected to run locally using split systemd user services:

- `pi-web-sessiond.service` runs `npm run start:sessiond` in non-autoreload, non-auto-restart mode.
- `pi-web-ui-dev.service` runs the web/API, bundled-plugin watcher, and Vite UI with `npm run dev:web` and `npm run dev:client`.

`src/server/index.ts` and `src/server/app.ts` own the browser-facing Fastify gateway. `src/server/sessiond.ts` owns long-lived Pi sessions, normal-mode project-scoped provider auth, terminals, activity, and realtime session events. The gateway reaches the daemon through `src/sessiond/sessionDaemonClient.ts` and proxy routes.

Normal-mode session runtimes resolve their credential and model registry from the owning registered project through `ProjectAuthService`; management-embed mode uses its separate managed `AuthService` and storage. Do not collapse those two auth ownership boundaries.

Browser disconnects and UI/API restarts must not stop active Pi sessions. Keep daemon-owned state and side effects out of the autoreloading web process.

Idle transcript refresh must preserve the SDK's selected leaf: unsummarized tree navigation and reset-to-root can change only in-memory state. Do not replace that branch with the disk tail, including when navigation finishes during an asynchronous read; retain external-append refresh when the runtime is at its latest entry.

Changes affecting `src/server/sessiond.ts`, the daemon protocol/transport, or transitive daemon-only code under `src/server/sessions/`, `src/server/terminals/`, `src/server/activity/`, or `src/server/realtime/` require a manual `pi-web-sessiond.service` restart. Tell the user when this is required. Web/API/client/plugin-only changes normally need only the `pi-web-ui-dev.service` autoreload path.

The default daemon transport is `$PI_WEB_DATA_DIR/sessiond.sock`; it can instead use the configured sessiond HTTP transport. If the protocol, socket/data-dir, or transport environment changes, keep both services aligned and restart both.

## Server and API boundaries

- Local machine capabilities are intentionally available under both legacy `/api/...` routes and `/api/machines/local/...` routes. Remote-machine variants are proxied under `/api/machines/:machineId/...`.
- When adding a machine-capable HTTP or WebSocket endpoint, update `src/shared/federatedRoutes.ts`, the local route registration, the client API, and the federated route contract tests together.
- Keep shared request/response types in `src/shared/apiTypes.ts`. Treat network responses as untrusted: validate them in `src/client/src/api/parsers.ts` or its parser modules instead of casting in components or controllers.
- Centralize browser transport in `src/client/src/api/`: endpoint families in `clients.ts`, URL construction in `urls.ts`, HTTP/auth scoping in `http.ts`, and sockets in `sockets.ts`.
- Management embed is a cross-process security boundary. The web gateway authenticates and constrains the request; the daemon consumes the forwarded management context and uses the separate management provider-auth store. Preserve that context on every applicable HTTP mutation and WebSocket route.
- Current server notices belong to normal-mode daemon state. Reject management-context reads and dismissals in the daemon, and do not request those notices from management-embed clients; browser-only errors remain available there.
- Normal-mode browser access auth and Pi model-provider auth are unrelated. Do not conflate `normalAuth.passwordHash` with provider API keys or auth files.
- Normal-mode provider-auth endpoints require a `projectId` and must resolve it to a registered project. Carry the typed `AuthRequestTarget` through provider lookup, API-key save/logout, and every OAuth lifecycle request; management-embed requests instead derive their store from the forwarded management context.
- Normal-mode session operations must resolve their `cwd` to exactly one registered project's workspace before listing, starting, or opening a runtime. That resolution selects the model registry; never fall back to ambient global Pi credentials. Process auth changes by exact model-registry identity so credentials changed for one project cannot refresh or warn sessions belonging to another.

## Management embed and Workbench

- Ordinary mode keeps PI WEB's existing unrestricted tool and resource behavior. Workbench resources, capability controls, Skill synchronization, sandbox restrictions, and externally managed permissions apply only to management-embed sessions; never reuse those restrictions as normal-mode defaults.
- Management-embed sessions may use the managed file tools and the custom `python` tool. Python must remain workspace-only, network-disabled, and isolated through Bubblewrap; do not replace it with the upstream generic Python or shell execution path.
- Generic `bash`, shell, PowerShell, terminal, MCP, HTTP, web-fetch, and web-search tools remain denied to the management agent. The presence of a Bubblewrap helper for terminal internals does not make the generic agent `bash` tool safe. Add any future managed shell capability as a separate constrained tool rather than removing these denies.
- When enabled by their global feature switches, management sessions may receive `spawn_session`, the complete tracked-subsession tool set headed by `spawn_subsession`, and `ask_user`. Keep the originating management context on every spawned session and subsession. Register the same controlled tool-name set in both the Pi permission policy and runtime `tools` list, and preserve an explicit management-context deny as authoritative.
- The Workbench adapter exchanges the entry token for a private Agent Session, keeps access and capability tickets server-side, loads only the authorized fixed resource and Skill versions, and exposes only the controlled capability tools. Concurrent bootstrap requests carrying the same entry token must reuse one Agent Session; do not amplify one embedded page load into multiple upstream sessions.
- Normal-mode tool audits retain the existing structured service log and additionally store metadata-only records in `$PI_WEB_DATA_DIR/audit/normal-tool-calls.sqlite`. Management-mode audits retain the service log and use weekly Elasticsearch indices with user, root-user, project, session, and Workbench Agent Session identity. Never persist prompts, arguments, results, model replies, tokens, credentials, cookies, or tickets in either audit store.
- Workbench integration and management audit construction span the web gateway and session daemon. Keep both processes on the same effective endpoints and limits, and restart both when those settings or their forwarded protocol change. Session runtime, permission, tool, or audit changes under `src/server/sessions/` still require an explicit `pi-web-sessiond.service` restart.

## Client and plugins

- `src/client/src/components/PiWebApp.ts` is the client composition root, not the default home for new domain logic. Put state orchestration in controllers, responsive shell behavior in `appShell/`, transport in `api/`, and keep Lit components focused on rendering and event wiring.
- Recurring asynchronous browser work must check connection lifetime before rescheduling. Clearing a timer on disconnect is insufficient once its callback is awaiting a request; an old connection's completion must not restart or replace the new connection's timer.
- Browser PI WEB plugins are trusted code and are separate from Pi packages. Bundled plugins live under `pi-web-plugins/<id>/` and build into `dist/pi-web-plugins/`.
- `src/plugin-api.ts` is the source of the stable public plugin API. `src/plugin-api/unstable.ts` is explicitly unstable. Do not hand-edit generated `plugin-api.d.ts`; run `npm run build:plugin-api`.
- Plugins should prefer documented context helpers over direct private `/api/...` calls. Keep activation cheap and declarative, and preserve machine scoping for remote plugin contributions and assets.
- When changing Chinese UI copy, update the owning component/plugin and relevant copy assertions, including `src/client/src/coreUiChineseCopy.test.ts` where applicable.
- `AuthController` snapshots the machine and, in normal mode, selected project into `AuthDialogTarget` when an auth flow starts. Keep that target through asynchronous OAuth polling and only refresh the session status while it remains selected; do not retarget an in-flight flow from mutable current UI state.
- Session-list components render menu interaction only; route rename mutations through `SessionController` and the existing `/name` command path. Rename only persisted, unarchived sessions, trim/reject blank names, preserve the currently selected conversation when renaming another row, and keep list/selection metadata synchronized through `session.name` events.
- Keep attachment staging synchronized on add, remove, and composer reset, not only on session switches. Temporary-to-persisted session ID migration must preserve unsent attachments without recreating the abandoned temporary key; test the controller migration before the editor's next update.
- Preserve the chat scroll layout invariant: `.chat-wrap` owns the constrained flex area and `.chat` is the absolute `inset: 0` scrolling element. Do not replace it with `height: 100%`, or long transcripts can no longer reach their bottom.

## Client application URL convention

- Build PI WEB-owned browser paths as application-relative references without a leading slash, for example `api/...` and `pi-web-plugins/...`.
- Encode every dynamic path segment with `encodeURIComponent`; encode query values, using `URLSearchParams` for multi-field queries.
- Resolve each reference exactly once at the browser boundary: ordinary JSON HTTP paths go to `request()`, direct browser APIs receive URLs from helpers backed by `resolveAppUrl()`, and WebSockets use `resolveAppWebSocketUrl()`.
- Name helpers returning unresolved application references with a `Path` suffix and helpers returning browser-ready absolute values with a `Url` suffix.
- Plugin module references must go through `resolvePluginModuleUrl()`. Its leading-slash handling is the documented rolling-compatibility exception; do not introduce other leading-root app references.
- Pre-JavaScript HTML assets use Vite `%BASE_URL%`; PWA manifest references stay `./`-relative. External links, data URLs, and module-relative plugin assets are not application paths.
- To assess deviations, search production client code for raw `fetch`, `WebSocket`, `XMLHttpRequest`, URL-bearing DOM attributes, and leading `/api` or `/pi-web-plugins` literals. Every app-owned result must follow one of the boundaries above.
- Published nested deployments require a canonical trailing slash; the reverse proxy must redirect a slashless prefix before serving the app.

## Configuration conventions

- `$PI_WEB_DATA_DIR` (`~/.pi-web` by default) contains PI WEB-managed state such as `projects.json`, `machines.json`, plugin discovery state, daemon IPC/auth data, and normal-mode per-project provider credential/model stores. Do not treat it as the user-editable config API.
- Global user/machine config lives at `$PI_WEB_CONFIG` or `~/.config/pi-web/config.json`. The web process and daemon must use the same effective global config.
- Normal-mode `auth.json` and `models.json` live under the managed data directory in a stable store keyed by the normalized absolute project path, not in the checkout or the commit-able project config. All worktrees of one project share that store. On first use, copy the effective global Pi agent files once (or create empty defaults if absent); later global-file changes are not a fallback and must not overwrite an existing project store. Keep the files private and preserve the separate management-embed credential store.
- Session preference defaults (`defaultThinkingLevel`, `defaultProvider`, `defaultModel`) are stored as mode×project overrides under `$PI_WEB_DATA_DIR`: normal mode co-locates `settings.preferences.json` with the project auth store; management embed uses `management-embed/projects/<hash>/settings.preferences.json` (or `management-embed/orphan/<cwdHash>/` when cwd is not a unique registered project). Normal mode stores `enabledModels` in the same project scope because every project owns a separate model registry; management mode hides it. Sessions keep reading other shared agent settings (packages, extensions, proxy, etc.) from the real agentDir `settings.json`. Do not write project-scoped settings back into the shared global agent dir from PI WEB session runtimes.
- Project-local PI WEB core config uses one commit-able file: `<project>/.pi-web/config.json`.
- Core features add keys to these config files rather than creating one project file per feature. Plugins may own separate project files such as `.pi-web/tasks.json`.
- In federated UI flows, machine-affecting settings target the selected machine. Gateway bind/allowed-host settings, machine registration/tokens, and browser shortcut preferences remain local to the gateway/browser.

## Code quality and testing

Use `.agents/skills/code-quality-architecture/SKILL.md` whenever writing, modifying, reviewing, or planning production code or architecture. Keep changes proportionate, dependencies explicit, side effects contained, and framework-facing code thin.

Use `.agents/skills/testing-guide/SKILL.md` whenever writing, modifying, reviewing, or planning tests, closing coverage gaps, triaging failures, or creating test helpers/harnesses.

Run the narrowest meaningful test first. Also run `npm run typecheck` for source or exported-type changes. Use `npm run verify` (`typecheck`, `lint`, `knip`, and Vitest) for cross-cutting work and before final merge review.

For project-auth changes, cover first-use bootstrap/isolation, client target propagation, and the federated route contract. For session rename changes, cover menu eligibility/input and controller behavior when the renamed row is not the active conversation. Keep the chat layout assertion in `src/client/src/components/shared.test.ts` when changing transcript scrolling styles.

POSIX shell assets executed by Docker must retain LF line endings, including the shebang. Check bytes as well as shell syntax; Windows checkout must honor the installer's `.gitattributes` rule.

## Changes and releases

Use `.agents/skills/changeset-changelog/SKILL.md` for user-visible features, fixes, configuration/install changes, or documentation shipped in the npm package. Add a `.changeset/*.md` fragment when required; do not edit `CHANGELOG.md` manually during normal development.

Use `.agents/skills/npm-release-via-github-actions/SKILL.md` for versioning or release work. Publishing happens through GitHub Release-triggered Actions, not by publishing from the local machine. Run `npm run pack:dry` when package contents are part of the change.
