# @chainingintention/pi-web-cn

## 1.202606.11

### Patch Changes

- 4b821c6: Add image attachments to chat prompts for Pi models that support image input.

## 1.202606.10

### Patch Changes

- Support large local workspace file uploads with streamed transfer, and disable the upload action for remote machines until remote uploads support the same flow.

## 1.202606.9

### Patch Changes

- Translate newly added command palette actions and live activity status labels into Chinese.

## 1.202606.8

### Patch Changes

- 15cba02: Replace management embed remote introspection with locally verified signed tokens and a 24-hour server-side management session.

## 1.202606.7

### Patch Changes

- Create a default management-embed project for the logged-in user when the platform session has no authorized projects yet.

## 1.202606.6

### Patch Changes

- a73bceb: Reduce desktop navigation crowding by moving machine switching into a compact header control and removing automatic desktop section collapse.
- 9a3f2ce: Make navigation sections collapsible on desktop and auto-collapse completed context sections after selections.
- 271c990: Document machine federation across the website and add a Fleet guide for setup, trust model, remote plugins, and troubleshooting.
- 351ed03: Add a keyboard shortcuts settings editor with manual entry, recording, disabling, reset-to-default controls, and conflict/shadowing indicators.
- f7eff88: Make the app refresh control perform a full page reload directly instead of opening refresh-data options.
- ad963a2: Simplify the mobile location breadcrumb by hiding the machine crumb when there is only one configured machine and removing activity indicators from breadcrumb items.
- f3e19d1: Add keyboard-first navigation for focusing Machines, Projects, Workspaces, Sessions, and the chat composer.
- b35ce1d: Reduce repeated machine and workspace details in the chat status bar and workspace tool header, keeping compact session metrics right-aligned.
- 25d8188: Keep the documentation site's GitHub and theme controls visible in mobile portrait layouts.
- 058fdee: Clarify plugin docs and website copy around private PI WEB APIs and the supported helper surface.
- b616684: Add draggable, persistent side panel resizing for the web UI navigation and workspace panels, including reset actions.
- b2a7975: Align the desktop machine badge status to the right edge of the badge.
- f501f9d: Pin navigation activity indicators to the top-right of list chips so active projects, workspaces, and sessions no longer shift their labels.
- 2f72169: Add workspace file management actions in the file panel, with server-side path checks that keep uploads, moves, deletes, new files, new folders, and downloads inside the selected workspace. Downloads also work from the management embed entry point.

## 1.202606.5

### Patch Changes

- 210cc0e: Harden management embed sessions by running Python through a bubblewrap sandbox when available, falling back to a restricted managed Python runner on hosts that block bubblewrap namespaces, removing inherited host secrets from managed tool environments, and blocking managed terminal command runs.

## 1.202606.4

### Patch Changes

- 709854c: Hide the core terminal entrypoints when PI WEB is opened in management embed mode.

## 1.202606.1

### Patch Changes

- 93b50e6: Replace add-machine browser prompts with a PI WEB form that asks for the remote URL first, suggests a machine name, and supports an optional bearer token.
- 08f69d0: Document built-in PI WEB plugins, including configuration guidance for Workspace Tasks.
- Translate bundled plugin display text into Chinese.
- Document this fork as a Chinese translation plan for PI WEB plugin display content.
- 159f533: Fix workspace selection in the web UI so local machine project and session loading no longer fails with `api is not defined`.
- ccd4a76: Hide the Machines navigation section when only one machine is configured, align Machines list spacing with the other navigation sections, and add a remove action to remote machine rows.
- 193c9d0: Show machine activity indicators when sessions or terminals are active on any workspace for that machine.
- b5f8810: Add machine-scoped local project, workspace, file, and git API aliases as the next step toward machine federation.
- 4495a26: Make the mobile Actions entry available from the top context controls and remove the redundant PI WEB navigation header on mobile.
- 4548e5c: Use compact icons, initials, and inline badges for the mobile main tab bar so tabs are easier to fit without losing horizontal scrolling; let workspace panel plugins provide custom SVG tab icons; and add icons for bundled Info, Updates, and Tasks plugin panels.
- e352dce: Fall back to the local machine when a bookmarked or restored remote machine is offline, and clear stale remote workspace route state.
- bd8d1f1: Keep workspace tool tab icons visible in the desktop workspace panel and collapse tab names only in compact panel widths.
- 08f69d0: Add plugin enablement settings so discovered PI WEB plugins can be disabled before the browser imports them.
- e3533eb: Add documented plugin context helpers for machine-scoped workspace files and terminal commands, generate plugin API declarations from source, and move bundled plugins away from direct PI WEB API calls.
- 8cd2bba: Keep the PWA refresh control menu visible above mobile tab navigation and workspace tab content.
- b3bb732: Remember each machine's last selected project, workspace, session, and workspace tool when switching machines in the web UI.
- a142f5e: Add remote machine federation so PI WEB can register trusted remote runtimes and proxy their projects, workspaces, sessions, files, git state, activity, and terminals through the current web server.
- f1c8f1f: Clean up the workspace panel plugin context by removing the legacy `openTerminal` alias and moving render invalidation to `context.host.requestRender()`.
- 4495a26: Add a deep-linked Settings UI for editing the active PI WEB config file and viewing registered keyboard shortcuts.
- a58c211: Add shortcut preferences to the PI WEB config schema so keyboard shortcuts can be overridden or disabled by action id.
- 0405b38: Add the first machine registry API and show the synthesized Local machine in the web UI as the foundation for machine federation.
- be02c35: Rename the built-in Updates plugin id from `pi-web` to `updates` for clearer plugin configuration.
- 08f69d0: Prevent redundant Workspace Tasks panel re-renders from resetting mobile scroll position or replacing task buttons mid-click, and show feedback for stale, cancelled, or already-starting tasks.
- 08f69d0: Bundle Workspace Tasks with PI WEB as a built-in plugin for running `.pi-web/tasks.json` commands in workspace terminals.

## 1.202606.1

### Patch Changes

- 93b50e6: Replace add-machine browser prompts with a PI WEB form that asks for the remote URL first, suggests a machine name, and supports an optional bearer token.
- 08f69d0: Document built-in PI WEB plugins, including configuration guidance for Workspace Tasks.
- 9c3dafc: Delete workspaces through a server-side operation that closes target workspace terminals before running the worktree removal command, preventing stale machine activity indicators.
- 159f533: Fix workspace selection in the web UI so local machine project and session loading no longer fails with `api is not defined`.
- 82ba2e0: Prevent malformed session prompt API calls from crashing the session daemon.
- f2d211d: Harden remote machine plugin asset proxying so plugin asset URLs cannot escape the remote plugin directory.
- ccd4a76: Hide the Machines navigation section when only one machine is configured, align Machines list spacing with the other navigation sections, and add a remove action to remote machine rows.
- 193c9d0: Show machine activity indicators when sessions or terminals are active on any workspace for that machine.
- b5f8810: Add machine-scoped local project, workspace, file, and git API aliases as the next step toward machine federation.
- 4495a26: Make the mobile Actions entry available from the top context controls and remove the redundant PI WEB navigation header on mobile.
- 4548e5c: Use compact icons, initials, and inline badges for the mobile main tab bar so tabs are easier to fit without losing horizontal scrolling; let workspace panel plugins provide custom SVG tab icons; and add icons for bundled Info, Updates, and Tasks plugin panels.
- e352dce: Fall back to the local machine when a bookmarked or restored remote machine is offline, and clear stale remote workspace route state.
- bd8d1f1: Keep workspace tool tab icons visible in the desktop workspace panel and collapse tab names only in compact panel widths.
- 30fb960: Preserve machine, workspace, session, and terminal navigation memory across reloads within each browser tab.
- 08f69d0: Add plugin enablement settings so discovered PI WEB plugins can be disabled before the browser imports them.
- e3533eb: Add documented plugin context helpers for machine-scoped workspace files and terminal commands, generate plugin API declarations from source, and move bundled plugins away from direct PI WEB API calls.
- 8cd2bba: Keep the PWA refresh control menu visible above mobile tab navigation and workspace tab content.
- b3bb732: Remember each machine's last selected project, workspace, session, and workspace tool when switching machines in the web UI.
- a142f5e: Add remote machine federation so PI WEB can register trusted remote runtimes and proxy their projects, workspaces, sessions, files, git state, activity, and terminals through the current web server.
- b9be7de: Load trusted PI WEB plugins from selected federated machines with machine-scoped actions, workspace panels, labels, proxied plugin assets, and gateway-preferred duplicate handling.
- f1c8f1f: Clean up the workspace panel plugin context by moving render invalidation to `context.host.requestRender()` and deprecating the legacy runtime-only `openTerminal` alias in favor of `context.terminal.open()`.
- 4495a26: Add a deep-linked Settings UI for editing the active PI WEB config file and viewing registered keyboard shortcuts.
- a58c211: Add shortcut preferences to the PI WEB config schema so keyboard shortcuts can be overridden or disabled by action id.
- 0405b38: Add the first machine registry API and show the synthesized Local machine in the web UI as the foundation for machine federation.
- 4bc0010: Add workspace file and render helpers to plugin workspace label callbacks so labels can load workspace-scoped metadata without hidden panels.
- 08f69d0: Prevent redundant Workspace Tasks panel re-renders from resetting mobile scroll position or replacing task buttons mid-click, and show feedback for stale, cancelled, or already-starting tasks.
- 08f69d0: Bundle Workspace Tasks with PI WEB as a built-in plugin for running `.pi-web/tasks.json` commands in workspace terminals.

## 1.202606.0

### Patch Changes

- 6c094af: Keep slash command autocomplete visible above the chat status indicator.
- bad3a18: Add an action-palette command for deleting browser-cached new sessions, while keeping archive and delete session actions context-specific.
- fdd2cf2: Keep chat file mention suggestions working on installations that do not have ripgrep available, add an all-file `@` mention mode, stop hiding directories in the file explorer, and report optional ripgrep availability in `pi-web doctor`.
- a038da6: Fix mobile browser layout so the app no longer leaves an extra bottom gap above browser controls while preserving standalone PWA safe-area spacing.
- 9c80eb0: Avoid suggesting unavailable `pi-web` restart commands for local checkout installs, and show native service commands only when PI WEB can detect matching service files.
- 5090661: Add `pi-web version` and include installed and running PI WEB version details in doctor output.
- 9c80eb0: Rename the PI WEB status workspace tab to Updates so version and restart guidance is easier to find.

## 1.202605.14

### Patch Changes

- 3bd4773: Correct the chat history range label when normalized display messages are fewer than the raw session transcript entries.
- 1c1740a: Keep left navigation section titles visible while project, workspace, and session lists scroll.
- 5737b22: Add a collapse control for the left navigation panel in wide and two-panel layouts.
- 50f1ddc: Refresh session list message counts from live session status updates.
- c73ac5b: Keep PWA navigation bars visible after returning to the app from the background.
- 2abd1d9: Queue prompts submitted during session compaction in pi-web and deliver them only after compaction finishes.
- 958596a: Make `pi-web status` print a concise service health report without invoking paged system service output.
- f569467: Add an optional terminal soft-key bar for common control, navigation, and Meta-style key sequences, with mobile-friendly defaults and a persistent toggle.
- 61a763a: Keep the chat status indicator bubble above sticky message titles.
- 559c6f6: Add a desktop edge control for collapsing and expanding the workspace tools panel.

## 1.202605.13

### Patch Changes

- 57a6a4a: Improve `pi-web doctor` to report missing commands safely, skip Linux systemd checks on non-Linux platforms, and avoid misleading restart advice after the macOS node-pty permission workaround.
- 34e657d: Add a `pi-web doctor` diagnostic for the upstream macOS node-pty `spawn-helper` permission issue, including the workaround and tracking links.
- 8247281: Add macOS LaunchAgent service installs and a shared development install mode with `pi-web install --dev`.
- 4bfd4ac: Add homepage and remote-first website copy that explains PI WEB's persistent-by-default agent workflow.
- 679008d: Fix workspace and project activity indicators so stale session activity clears instead of reappearing after idle sessions.
- 56fa641: Restore spellcheck and autocorrect for prose in the web chat prompt while keeping command-like input protected from autocorrection.
- 711c4f3: Run workspace deletion and configurable workspace actions in visible PI WEB terminals with reload-safe command-run tracking, mobile-friendly cancellation, and shell continuation after command completion.

## 1.202605.12

### Patch Changes

- 13bb8e4: Add a theme-aware dash favicon and uppercase PI WEB page titles.
- 428f7bb: Add a session list action to archive a session together with its descendant sessions in the same workspace.
- f4aeb06: Make the mobile location breadcrumbs clickable so they open project, workspace, or session selection directly.
- 5bc2542: Extend chat diff row backgrounds across the full horizontal scroll area.
- 9e3d272: Prefill the prompt editor with the selected user message after forking a session.
- 23e82e1: Improve empty states for workspace tools and session selection when no project, workspace, or session is selected.
- a1e903f: Add cached image previews up to 10 MB to the workspace file browser for common image file types.
- df20563: Add refresh controls when PI WEB is launched as a PWA, with action palette commands for refreshing app data or reloading the page.
- 2f5293a: Fix mobile workspace panels, including the PI WEB status panel, so overflowing content remains scrollable on iPhone.
- 3409b0a: Name newly forked and cloned web sessions with readable Fork and Copy counters based on the source session title.
- 6a8f2f2: Prevent the message composer from inserting a stray blank line when starting a new session with the keyboard shortcut.
- 1546143: Add PWA manifest icons so installed PI WEB apps use the project icon.
- 1546143: Standardize user-facing PI WEB branding in uppercase across the app, docs, and install metadata.

## 1.202605.11

### Patch Changes

- 1f06b25: Make the Pi Web light/dark themes the default automatic theme pair and keep Classic as the fallback for missing theme selections.
- 619840a: Clear stale workspace activity indicators when sessions become idle or all remaining sessions are archived.
- 9d4a017: Deep-link terminal selection so action-created terminals open directly and reload back to the same terminal.
- 698a899: Load and watch first-party workspace plugin packages from the single Pi Web development command without requiring local symlinks.
- fb7903f: Document and harden separate Pi Web plugin package development, including the Actions plugin refresh flow and public terminal navigation helper.
- 32182a5: Allow Pi package installs to create systemd services from bundled Pi Web entrypoints when `pi-web-server` and `pi-web-sessiond` are not on the service shell PATH.
- 8fbdd6e: Prevent resize observers from attaching to missing UI elements during panel rerenders.
- 1f06b25: Keep loading other external plugins when one plugin fails during registration.
- 2631a63: Add persistent project, workspace, and session context in the web UI so mobile users keep their location visible while navigating between panels and chat.
- 3da2fcf: Add in-place overflow lenses for workspace rows so truncated workspace labels and plugin links can be read or clicked, and cap long project and session names to two lines.
- 894c4d0: Avoid automatically reselecting archived-only sessions unless an archived session was explicitly selected, and let closing the archived section clear archived session selection.
- cf1b0ed: Replace the workspace hover lens with a workspace actions/details menu so metadata remains accessible without blocking list scrolling or shifting rows.
- ea5d863: Preserve chat scroll positions more reliably across session and workspace changes, and keep live event groups collapsed when users close them during streaming.
- 0a086c9: Keep action-palette plugin actions responsive when they change workspace tools or routes.
- 3cce6d2: Rework chat scroll restoration around explicit bottom and anchor positions so session navigation and streaming updates keep the user's reading position stable.
- e5bc87b: Add a Go to Terminal action with a keyboard shortcut and clarify that plugin shortcuts are default keybindings attached to actions.

## 1.202605.10

### Patch Changes

- fb9e524: Build bundled Pi Web plugins from TypeScript during development and release packaging while shipping browser-loadable JavaScript modules.
- b637add: Update static file serving and WebSocket dependencies to patched releases, removing controlled dependency warnings and npm audit findings.
- ebe5639: Show active session and terminal activity on project and workspace rows so background work is visible from navigation.

## 1.202605.9

### Patch Changes

- 9c028a7: Move archived session files out of active Pi session directories so normal session lists no longer scan archived histories.
- 1d8dba9: Fix the homepage Keep control card icon so it renders clearly across browsers.
- c5dc655: Replace the chat history banner with a count-based conversation position meter that shows approximate message position without extra requests.
- 6f7713f: Contain long edit diff lines inside the diff viewer so they scroll horizontally within the tool card instead of widening the chat transcript.
- ee6f60f: Improve Pi Web tool cards for edit operations with live preview updates, paired call/result display, and rendered diffs that match the TUI more closely.
- 545499a: Add friendlier rotating in-progress response notices when opening a chat mid-reply.
- 71ce2fb: Make workspace navigation bars horizontally scrollable on desktop and mobile, with side shadows showing when more items are available.
- 547b6e6: Expand the live trailing events group while a session is active, then collapse it again once readable conversation output appears.
- e89441f: Make the mobile navigation panel sections collapsible so projects, workspaces, and sessions can each use more screen space.
- babb802: Add a beta-labeled Pi Web status panel with update instructions tailored to global npm, Pi package, or local installs. The panel appears for update/restart messages and stays visible for local or unknown installs, while keeping the bundled Info plugin as the minimal documented plugin example.
- 6f7713f: Keep chat bubble and event group headers sticky while scrolling so long messages remain easier to orient within the transcript.
- b51d56c: Add theme tokens, a theme picker, and built-in current/docs-inspired themes for the Pi Web UI.

## 1.202605.8

### Patch Changes

- c77c47c: Document the Pi Web CalVer release rule so releases use the release month, increment the patch component for additional releases in the same month, and require explicit user confirmation before any breaking major release.
- 3099579: Document and tighten the Pi Web plugin API around explicit `piWeb.plugins` metadata, versioned browser modules, AI-oriented local plugin development, website plugin docs on pi-web.dev, feedback guidance, and resilient discovery that skips invalid plugins without hiding valid ones.

## 1.202605.7

### Patch Changes

- aab9ffb: Preserve newly started empty sessions and their prompt drafts across browser reloads until the user deletes them.
- c5bc855: Improve `pi-web doctor` and `pi-web install` to use the detected bash, zsh, or fish login shell, verify the systemd user service context can find required commands before installation, and print shell-specific PATH setup advice without persisting transient PATH values.
- 9b1b1bb: Fix the docs mobile navigation so FAQ pages no longer overflow and compact the GitHub/theme controls on small screens.
- 0aa0a13: Fix chat history reloads so previously displayed messages are not duplicated from the browser cache.
- 42cad58: Add remote-first development positioning to the website and docs, including a philosophy page and laptop-versus-server FAQ guidance.
- c66d834: Add a static Pi Web website with installation docs, troubleshooting FAQ, and GitHub Pages deployment.
- 6a8f8b6: Add global web UI `/login` and `/logout` flows for configuring API key and subscription provider authentication.

## 1.202605.6

### Patch Changes

- 559436c: Install Pi Web services from the Pi extension using the normal login-shell command shims instead of hardcoded Node paths, so sessions use the same PATH for node and npm.
- c547478: Keep mobile workspace selection in the Sessions view so users can confirm the remembered session before opening chat, and restore mobile URLs without an explicit view back to Sessions.
- 42b9c53: Remove unsupported direct GitHub install instructions from the README.

## 1.202605.5

### Patch Changes

- a807569: Fix browser terminal sizing so progress/status lines update in place instead of wrapping when the PTY size has not caught up with the visible terminal.
- d064c4e: Improve package gallery discoverability for remote web UI and browser control plane searches.

## 1.202605.4

### Patch Changes

- 7a9e7db: Copying selected rendered chat markdown now places the raw markdown source on the clipboard.
- cf43c95: Formalize release notes with Changesets and project-local skills for changelog and npm publishing workflows.
- e12382c: Keep a new prompt separate from the stopped prompt after aborting a session turn.
