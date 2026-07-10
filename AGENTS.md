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

`src/server/index.ts` and `src/server/app.ts` own the browser-facing Fastify gateway. `src/server/sessiond.ts` owns long-lived Pi sessions, provider auth, terminals, activity, and realtime session events. The gateway reaches the daemon through `src/sessiond/sessionDaemonClient.ts` and proxy routes.

Browser disconnects and UI/API restarts must not stop active Pi sessions. Keep daemon-owned state and side effects out of the autoreloading web process.

Changes affecting `src/server/sessiond.ts`, the daemon protocol/transport, or transitive daemon-only code under `src/server/sessions/`, `src/server/terminals/`, `src/server/activity/`, or `src/server/realtime/` require a manual `pi-web-sessiond.service` restart. Tell the user when this is required. Web/API/client/plugin-only changes normally need only the `pi-web-ui-dev.service` autoreload path.

The default daemon transport is `$PI_WEB_DATA_DIR/sessiond.sock`; it can instead use the configured sessiond HTTP transport. If the protocol, socket/data-dir, or transport environment changes, keep both services aligned and restart both.

## Server and API boundaries

- Local machine capabilities are intentionally available under both legacy `/api/...` routes and `/api/machines/local/...` routes. Remote-machine variants are proxied under `/api/machines/:machineId/...`.
- When adding a machine-capable HTTP or WebSocket endpoint, update `src/shared/federatedRoutes.ts`, the local route registration, the client API, and the federated route contract tests together.
- Keep shared request/response types in `src/shared/apiTypes.ts`. Treat network responses as untrusted: validate them in `src/client/src/api/parsers.ts` or its parser modules instead of casting in components or controllers.
- Centralize browser transport in `src/client/src/api/`: endpoint families in `clients.ts`, URL construction in `urls.ts`, HTTP/auth scoping in `http.ts`, and sockets in `sockets.ts`.
- Management embed is a cross-process security boundary. The web gateway authenticates and constrains the request; the daemon consumes the forwarded management context and uses the separate management provider-auth store. Preserve that context on every applicable HTTP mutation and WebSocket route.
- Normal-mode browser access auth and Pi model-provider auth are unrelated. Do not conflate `normalAuth.passwordHash` with provider API keys or auth files.

## Client and plugins

- `src/client/src/components/PiWebApp.ts` is the client composition root, not the default home for new domain logic. Put state orchestration in controllers, responsive shell behavior in `appShell/`, transport in `api/`, and keep Lit components focused on rendering and event wiring.
- Browser PI WEB plugins are trusted code and are separate from Pi packages. Bundled plugins live under `pi-web-plugins/<id>/` and build into `dist/pi-web-plugins/`.
- `src/plugin-api.ts` is the source of the stable public plugin API. `src/plugin-api/unstable.ts` is explicitly unstable. Do not hand-edit generated `plugin-api.d.ts`; run `npm run build:plugin-api`.
- Plugins should prefer documented context helpers over direct private `/api/...` calls. Keep activation cheap and declarative, and preserve machine scoping for remote plugin contributions and assets.
- When changing Chinese UI copy, update the owning component/plugin and relevant copy assertions, including `src/client/src/coreUiChineseCopy.test.ts` where applicable.

## Configuration conventions

- `$PI_WEB_DATA_DIR` (`~/.pi-web` by default) contains PI WEB-managed state such as `projects.json`, `machines.json`, plugin discovery state, and daemon IPC/auth data. Do not treat it as the user-editable config API.
- Global user/machine config lives at `$PI_WEB_CONFIG` or `~/.config/pi-web/config.json`. The web process and daemon must use the same effective global config.
- Project-local PI WEB core config uses one commit-able file: `<project>/.pi-web/config.json`.
- Core features add keys to these config files rather than creating one project file per feature. Plugins may own separate project files such as `.pi-web/tasks.json`.
- In federated UI flows, machine-affecting settings target the selected machine. Gateway bind/allowed-host settings, machine registration/tokens, and browser shortcut preferences remain local to the gateway/browser.

## Code quality and testing

Use `.agents/skills/code-quality-architecture/SKILL.md` whenever writing, modifying, reviewing, or planning production code or architecture. Keep changes proportionate, dependencies explicit, side effects contained, and framework-facing code thin.

Use `.agents/skills/testing-guide/SKILL.md` whenever writing, modifying, reviewing, or planning tests, closing coverage gaps, triaging failures, or creating test helpers/harnesses.

Run the narrowest meaningful test first. Also run `npm run typecheck` for source or exported-type changes. Use `npm run verify` (`typecheck`, `lint`, `knip`, and Vitest) for cross-cutting work and before final merge review.

## Changes and releases

Use `.agents/skills/changeset-changelog/SKILL.md` for user-visible features, fixes, configuration/install changes, or documentation shipped in the npm package. Add a `.changeset/*.md` fragment when required; do not edit `CHANGELOG.md` manually during normal development.

Use `.agents/skills/npm-release-via-github-actions/SKILL.md` for versioning or release work. Publishing happens through GitHub Release-triggered Actions, not by publishing from the local machine. Run `npm run pack:dry` when package contents are part of the change.
