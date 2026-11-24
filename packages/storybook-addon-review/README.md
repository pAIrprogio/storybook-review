# @pairprog/storybook-addon-review

Review Storybook stories in your browser and hand structured comments to any coding agent.

Comment on a whole story, click an element, or drag a region across any number of stories, then click **Send**. Your agent receives each comment along with its story file, test ID, accessible role/name, CSS path, bounding box, globals, and changed args.

![Storybook Review showing element and region pins on a story with the Review panel](https://raw.githubusercontent.com/pAIrprogio/storybook-review/main/docs/screenshot.png)

## Install

Requires **Storybook 10** and **Node 22+** (or **Bun**).

1. Install the package:
   ```bash
   npm install -D @pairprog/storybook-addon-review
   ```
2. Add it to `.storybook/main.ts`:
   ```ts
   addons: ["@pairprog/storybook-addon-review"],
   ```

Pair it with the [`storybook-review` agent plugin](https://github.com/pAIrprogio/storybook-review#1-install-the-agent-plugin) so your coding agent knows when and how to invoke it.

## Usage

Run from the repo root or a Storybook directory:

```bash
npx storybook-review [<story ID or title prefix>] [--port 6006] [--dir <folder>]
npx storybook-review --wait <session id>
```

- **Auto-discovery:** Finds `.storybook/main.*` in the current directory or below it (use `--dir` in monorepos with multiple Storybooks). Prints `SETUP_REQUIRED` with setup instructions if the addon isn't configured yet.
- **Lifecycle:** Reuses a Storybook already serving the addon, or starts the project's Storybook (with Bun in Bun projects, Node otherwise) and stops it after **Send**.
- **Long sessions:** If you take longer than 8 minutes, the CLI prints `PENDING <id>` so the agent can resume waiting with `--wait <id>`.
- **Zero noise:** The Review panel and toolbar button only appear in tabs opened by the CLI ([ADR 0003](./docs/adr/0003-ui-only-while-an-agent-listens.md)).

## Environment variables

| Variable | Effect |
|---|---|
| `STORYBOOK_REVIEW_WAIT_MS` | Wait timeout before printing `PENDING` (default: `480000`) |
| `STORYBOOK_REVIEW_NO_OPEN=1` | Do not open a browser window automatically |
| `STORYBOOK_REVIEW_SELF` | Command printed for follow-up runs (default: `npx storybook-review`, or `bunx` under Bun) |

## Architecture decisions

See [docs/adr](./docs/adr).
