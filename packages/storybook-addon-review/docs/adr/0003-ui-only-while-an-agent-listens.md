---
status: accepted
date: 2026-11-24
deciders: project owner
rejected: [environment variable set by the CLI]
---

# UI only while an agent listens

**Accepted 2026-11-24.** **The addon shows its Annotate panel, toolbar button and shortcut only in a browser tab that carries an agent session.** The CLI opens Storybook on a URL with `annotate=<session id>.<token>`, and the tab keeps that session in `sessionStorage` as the user moves between stories. In any other tab, the manager entry registers nothing. A comment is written only when an agent is waiting to read it.

**Related**
- Code: [manager.tsx](../../src/manager.tsx), [session-client.adapter.ts](../../src/session-client.adapter.ts)
- Decisions: [ADR 0001](./0001-screenshots-from-a-browser-extension.md)

## Context

- Before this, the panel showed in every Storybook that loaded the addon. Without a session it said "No agent is waiting. Comments stay in this tab", and those comments reached nobody.
- The addon ships to every teammate who opens the project's Storybook, most of whom never run an agent session.

## Options considered

| Option | Why not |
|---|---|
| **Session in the tab** (chosen) | - |
| Environment variable the CLI sets when it starts Storybook | The CLI also reuses a Storybook the user already runs. That process has no variable, so the panel would stay hidden while the agent waits. |

## Consequences

- Teammates who open Storybook without an agent see no trace of the addon. Its dev-server routes still answer, so the CLI can reuse their Storybook.
- A session that has ended (sent or expired) keeps the panel in its tab, showing why it can no longer send. A new tab without the session shows nothing.
- The canvas overlay is still installed in the preview, but it stays inert: it draws only what the manager sends it.
