# Claude Invaders

Space Invaders in the terminal, starring Clawd, the Claude Code mascot. Play it while
Claude works.

```
npm link                     # puts `claude-invaders` on your PATH
claude-invaders              # play in this terminal
claude-invaders --split      # open beside the current Windows Terminal pane
```

Needs a terminal of at least 80x30 with truecolor. No dependencies.

## Claude Code plugin

This repo is a plugin and its own marketplace:

```
claude plugin marketplace add D:/lab/claude-invaders
claude plugin install claude-invaders@claude-invaders
```

The plugin adds:

- `/invaders [tab|split]`, which opens a game in a new window, tab or split pane.
- `claude-invaders` on the `!` shell's PATH, so `! claude-invaders --split` needs no model turn.
- Hooks that tell a running game what Claude is doing. The footer shows `CLAUDE: WORKING`,
  and the game pauses with a jingle when Claude finishes or asks for permission
  (`--no-autopause` turns the pause off).

Claude Code holds `!` and slash commands until the current turn ends. To start a game
mid-task, keep one open in a split pane, or bind a Windows Terminal key to it:

```json
{ "command": { "action": "splitPane", "split": "right", "commandline": "claude-invaders" }, "keys": "ctrl+shift+i" }
```

## Controls

| Key            | Action                    |
| -------------- | ------------------------- |
| ← → / A D      | Move                      |
| Space          | Fire                      |
| P              | Pause                     |
| M              | Sound on/off              |
| B              | Boss key                  |
| Q / Esc        | Pause, then quit the game |

On Windows a small helper (compiled on first run with the .NET Framework `csc`) reports held
keys and plays sound. Elsewhere the game is silent and movement follows key repeat.

Scores and the helper live in `~/.claude-invaders`.
