# storybook-review

## Repo layout

| Folder | Role | Published as |
|---|---|---|
| `packages/storybook-addon-review` | Storybook addon (panel, canvas overlay, dev-server routes) and `storybook-review` CLI | npm `@pairprog/storybook-addon-review` |
| `plugins/storybook-review` | Agent plugin (skill only, no code) | [ai-marketplace](https://github.com/pAIrprogio/ai-marketplace), Agent Plugins, Agent Skills |
| `packages/playground` | Minimal Storybook for local addon development | — |

## Develop

```bash
mise install        # Bun
bun install
bun run build       # addon → packages/storybook-addon-review/dist
bun run test
bun run typecheck
bun run storybook   # playground on :6006
```

`bunfig.toml` sets `install.exact`, so `bun add` writes exact versions.

Run the CLI from source against the playground (rebuilds the addon first):

```bash
bun run review [<story>]            # e.g. bun run review example/button
bun run review --wait <session id>
```

A running Storybook keeps the addon build it started with — stop/restart it after changing the addon.
