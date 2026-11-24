---
name: storybook-review
description: Let the user review Storybook stories in their browser and leave comments on a whole story, an element or a region for you. Use when the user asks to review, annotate or give feedback on a component's look or stories, or after you change a component the user should check.
---

# Review Storybook stories

Opens the project's Storybook with a Review panel. On any number of stories, the user comments on the story as a whole, or picks an element (click) or a region (drag) on the canvas (⌘⇧C, Ctrl+Shift+C off macOS, toggles picking), then presses Send. The comments come back to you on stdout.

## Run

Run from the repo root (or the Storybook folder), and allow the command up to 10 minutes:

```
node <skill-dir>/scripts/run.mjs [<story ID or title prefix>] [--dir <Storybook folder>]
```

The argument is the story the browser opens on (`example/Button`, `example-button--primary`); without it Storybook opens its first story. The user can then move to any other story and comment there too, so one session can cover several components. It reuses a Storybook already serving the addon on port 6006 (`--port <n>` for another), or starts the project's own Storybook and stops it once the user has sent.

## Output

Output starts with one of:

- `ANNOTATIONS for Storybook stories (<folder>)`: numbered comments, grouped by story, each story with its ID and stories file. An element or region comment says where it points: CSS path, test ID, role and accessible name, text, box, globals, changed args. Address every comment; make the edits unless the user only wanted feedback. Report back per comment number.
- `... approved them with no comments`: continue.
- `PENDING <id>`: the user is still reviewing. Immediately run the `--wait <id>` command the output prints.
- `OPEN_FAILED <id>`: give the user the printed URL, then run the `--wait` command.
- `SETUP_REQUIRED`: the addon is not installed or not listed in the Storybook config. Ask the user, follow the printed steps, then run the printed command again.
- `ERROR: several Storybooks: …`: rerun with `--dir` set to the one holding the component; ask the user if you can't tell.
- `CANCELLED` / any other `ERROR`: tell the user and stop.

To find the code, start from the stories file: the component it shows sits next to it. Locate the element by its test ID, or its role and name; the CSS path describes the rendered DOM, so use it last.
