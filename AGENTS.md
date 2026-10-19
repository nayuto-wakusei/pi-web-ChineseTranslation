# Agent Notes

This is the Chinese-localized PI WEB fork. Preserve upstream functionality and Chinese core/bundled-plugin UI copy; do not translate protocol identifiers, API fields, commands, paths, or runtime payloads unless explicitly mapped for display. Use the GitHub username as commit author, with no email address.

## Read before changing code

Start at [maintenance docs](docs/maintenance.md). The relevant documents below are mandatory implementation constraints, not optional background. Read the matching module and its linked contracts before editing; read all affected modules for cross-cutting work.

| Work area | Required reading |
| --- | --- |
| Architecture, state ownership, browser lifecycle | [Architecture](docs/development/architecture.md) |
| Projects, workspaces, trust, Git removal | [Projects/workspaces](docs/modules/projects-workspaces.md) |
| Sessions, history, naming, queues, delegation, chat layout | [Sessions](docs/modules/sessions.md) |
| Provider auth, OAuth, model registries, preferences | [Auth/models](docs/modules/auth-models.md) |
| Files, previews, attachments, terminals, tasks | [Files/terminals](docs/modules/files-terminals.md) |
| HTTP/WS, federation, browser URLs, remote plugins | [Machines/API](docs/modules/machines-api.md) |
| Plugin lifecycle, public APIs, package resources | [Plugins](docs/modules/plugins.md) |
| Config, environment, settings scope | [Configuration](docs/modules/configuration.md) and [reference](docs/config.md) |
| Management permissions, Workbench, Skills, audit | [Management/audit](docs/admin/management-audit.md) |
| Services, notices, restarts, diagnostics | [Operations](docs/admin/operations.md) |
| Tests, delivery, release compatibility | [Change guide](docs/development/change-guide.md) |

## Non-negotiable boundaries

- Preserve `Machine -> Project -> Workspace -> Session`. Resource IDs are not globally unique: carry machine identity through state, URLs, caches, sockets, plugin registrations, and asynchronous updates.
- The Web/API gateway and session daemon are separate. Browser disconnects and Web/UI restarts must not stop daemon-owned Pi sessions or terminals. Keep long-lived state and effects out of the autoreloading Web process.
- Normal provider auth belongs to exactly one registered project; never fall back to ambient global Pi credentials. Keep management auth/models/preferences separate and browser access passwords distinct from provider credentials.
- Ordinary, restricted management, and fully privileged management are different permission modes. Never apply managed restrictions to ordinary sessions or drop management identity, context, separate credential/preference stores, or audit when granting full privileges. Enforce context at both gateway and daemon, including HTTP, WebSocket, and delegated sessions.
- Normal tool audit and service logs are metadata-only. Management audit retains user/visible assistant/tool content, excluding thinking; do not add authentication secrets as audit fields or expose management sessions to normal callers.
- Keep domain orchestration in controllers/services, not `PiWebApp.ts` or Lit rendering. Use shared API types, validate network responses, and centralize browser transport in `src/client/src/api/`.
- Add machine-capable HTTP/WS routes with local aliases, federation contracts, and clients together. App-owned browser URLs must be application-relative and resolved once through existing helpers.
- Config and managed state are different: core configuration belongs in global/project config files, not new per-feature files or direct edits to managed stores. Web and daemon must use matching effective cross-process configuration.

## Runtime and restart reporting

Local split services are `pi-web-sessiond.service` (`npm run start:sessiond`, no autoreload/auto-restart) and `pi-web-ui-dev.service` (`npm run dev:web` plus `npm run dev:client`). Read the operations restart matrix before changing lifecycle code.

Daemon-loaded code, runtime/tools/audit, or server-plugin changes require a manual daemon restart; tell the user. Web/API/UI and purely browser-plugin changes normally use the UI/Web reload path. Protocol, transport, data-dir, or shared cross-process configuration changes require both processes aligned and restarted. Do not equate a commit/push with deployment.

## Engineering and verification

Use [.agents/skills/code-quality-architecture/SKILL.md](.agents/skills/code-quality-architecture/SKILL.md) for production-code implementation, review, or planning. Use [.agents/skills/testing-guide/SKILL.md](.agents/skills/testing-guide/SKILL.md) for all test work, coverage, and failure triage.

Run the narrowest meaningful test first; source/exported-type changes also require `npm run typecheck`. Run `npm run verify` for cross-cutting work and before final merge review. This fork's pre-commit runs `npm run verify:staged`; do not replace that policy with upstream's whitespace-only hook while editing guidance.

Never report failed, incomplete, or skipped verification as passing. State unrun checks and reasons, preserve non-zero results, and explain intentional failure probes. See the change guide for module-specific regression and package-install requirements.

## Documentation and releases

编写或修改代码时，如果功能行为发生变化，必须在同一次改动中同步更新对应模块文档或权威参考，并删除或替换已失效的旧表述，不保留矛盾说明；Markdown/HTML 双版本同步更新受影响内容。

Keep README concise and details in their canonical `docs/` page; use [.agents/skills/documentation-guide/SKILL.md](.agents/skills/documentation-guide/SKILL.md) for documentation work. Keep this file as global constraints and required-reading navigation, not a growing list of module details.

Use [.agents/skills/changeset-changelog/SKILL.md](.agents/skills/changeset-changelog/SKILL.md) for user-visible changes and shipped docs; add required Changesets, never hand-edit CHANGELOG. For versioning/publishing, use [.agents/skills/npm-release-via-github-actions/SKILL.md](.agents/skills/npm-release-via-github-actions/SKILL.md): publish through GitHub Release Actions, not locally. Run `npm run pack:dry` when package contents change.
