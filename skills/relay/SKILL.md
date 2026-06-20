---
name: relay
description: "How the Relay method works: executing a plan as a chain of independent sessions that each do one slice and hand off to the next via spawn_session. Load this skill only when you already know you are in a relay: a prompt states you are working under the Relay framework (or relay/chain), points you at a relay charter or log, or the user invokes this skill directly. Do not load it for generic multi-step plans or ordinary spawn_session use."
---

# Relay

Relay is a way to execute a long or complex plan as a chain of independent sessions. Each session runs **one leg** — a single well-sized slice of the work — then hands the work off to a fresh session that runs the next leg. The chain continues until the goal is reached.

There is no coordinator and no referee. Each runner is the coordinator for their own leg: smart enough to do the work, adapt to what they discover, and hand off cleanly. Trust is distributed to every agent, not held by a god-agent above them.

The reason this works is **containment**: every leg starts with a fresh, small context. The accumulated knowledge lives in documents on disk, not in any one session's memory. That is also the core constraint you must respect — see below.

## The hard constraint that shapes everything

`spawn_session` is fire-and-forget. When you spawn the next leg, **you do not see its output and you cannot correct it.** The only thing that travels down the chain is what you wrote to disk. A human may be watching in the UI, but they intervene by reading your documents, not by relaying messages between sessions.

Two consequences follow, and they govern the whole method:

- **Make your work durable before you hand off.** Write the log, save/commit the artifacts (commit if the relay says to), and only then spawn the next leg. Anything not on disk is lost.
- **Hand off exactly once, at the end.** Do not spawn early, do not spawn several runners "to parallelize," and never spawn while you still have work in flight. One leg, one handoff.

## The two documents

A relay is carried by two documents. By default they live in `.pi-web/relays/<name>/` unless the user or the dispatching prompt says otherwise — always follow an explicit location if given.

**Charter** (`charter.md`) — the stable agreement, written when the relay is planned. It must contain, at minimum:

- **Goal / finish line.** A concrete, achievable end state. Without this the relay runs forever — this is non-negotiable.
- **Sizing.** How much is *one leg*? This is project- and plan-specific; the charter defines it (a task, a slice, a time/scope budget — whatever fits). The skill does not decide this for you.
- **Handover.** How a runner hands off: what the spawn prompt should say and what the next runner must read. Can be as simple as "read the charter and log, then continue," as long as it is stated.
- **Intervention signal.** When and how a runner must stop and get the human, and how that is made visible. The charter must define this; the skill does not define it for you.

The charter *can* be edited, but it should rarely *need* to be. If it is changing every leg, that is a smell — the design wasn't settled, or the goal is drifting. Treat frequent charter edits as a reason to stop and involve the human.

**Log** (`log.md`) — append-only, grows as the relay runs. Each leg appends an entry so the next runner can orient without inheriting your context. An entry records: what this leg did, decisions made and why, the current state, and any blockers. This is the relay's memory.

For a small relay it is fine to collapse both into a single file, as long as the goal, sizing, handover, and intervention signal are all present.

## Running one leg

This is the loop you run when you are dispatched into a relay.

1. **Orient.** Read the charter and the log. Understand the goal and the current state. If you are not sure you are in a relay, the prompt or `.pi-web/relays/` is your clue — and reading this skill means you are.
2. **Re-anchor to the goal.** Does the goal still make sense given what the log shows and what you now see? If reality has diverged from the charter, that is often an intervention moment — don't quietly redefine the task.
3. **Run one leg.** Do exactly one well-sized slice, per the charter's sizing. Resist doing "just a bit more" — extra scope bloats context and breaks the containment that makes Relay work.
4. **Log it.** Append your entry: what you did, why, the new state, and any blocker. Make all work durable (save files, commit if the relay calls for it).
5. **Decide: hand off, or stop.**
   - **Hand off** if there is a clear next leg and you are on track. Use `spawn_session` once, with a prompt that names the Relay method and points the next runner at the charter and log (so this skill loads and they can orient). Then you are done. Handoff is deliberately fire-and-forget: `spawn_session` starts an independent session you will not see and cannot steer — do not reach for a tracked subsession to keep an eye on it. Letting go is the point. The next runner is trusted to run their own leg, and the log is the only thread between you; if you feel the need to watch downstream work, that usually means the leg wasn't sized or handed off cleanly, or an intervention signal should have fired.
   - **Stop — do not spawn —** if the goal is reached, or you are blocked, or the charter's intervention signal fires. Leave a clear note in the log (and raise the intervention signal) so the watching human sees exactly what happened and what they need to decide. A stalled relay that stopped cleanly with a clear blocker is a success; a relay that spawned a confused next runner is a failure.

## Planning a relay

When the user asks to set up a relay, your job is to produce a charter (and an empty or seeded log) that has the four required slots filled: goal, sizing, handover, intervention signal. Draw each one out from the user rather than inventing it: ask what the finish line is, how much should be one leg, how runners hand off, and when you must stop and get them. Sizing and the intervention signal especially are the user's to decide — propose options if it helps them think, but do not quietly settle them yourself.

Do **not** impose what a "good" plan, leg size, or cadence looks like — those are deeply project-, plan-, and human-specific, and getting them wrong by being prescriptive is worse than leaving them to the user. Your value in planning is making sure the relay is *runnable*: the finish line exists, sizing is stated, handover is stated, and the intervention signal is stated. Once the charter is agreed, you can dispatch the first leg with `spawn_session`.

## Smells to watch for

- **No finish line** → infinite relay. Refuse to run a relay without a defined goal.
- **Goal drift** → each leg quietly restates the task. Re-anchor every leg.
- **Charter churn** → the charter changes every leg. The design isn't settled; involve the human.
- **Eager spawning** → spawning early, spawning several runners, or spawning before work is durable. One leg, one handoff, at the end.
- **Silent stall** → getting stuck and stopping with no note, or spawning anyway. Always log the blocker and surface it.
