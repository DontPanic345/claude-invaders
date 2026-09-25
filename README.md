# Claude Invaders

Space Invaders in your terminal, starring Clawd, the Claude Code mascot. Keep it open next
to Claude Code, and it pauses when Claude finishes.

![Clawd defending the codebase while Claude works](docs/gameplay.svg)

## Install

In Claude Code:

```
/plugin marketplace add DontPanic345/claude-invaders
/plugin install claude-invaders@claude-invaders
```

Then run `/invaders` to open a game in a new window. `/invaders split` opens it in a pane
beside Claude, and `/invaders tab` opens it in a new tab.

## Plays alongside Claude

The footer shows what Claude is doing. When Claude finishes or needs your permission, the
game pauses with a jingle so you know to switch back.

![The game pauses when Claude finishes](docs/claude-done.svg)

## Arcade features

- The march speeds up as the invaders fall, to the original four-note heartbeat.
- Shields crumble under fire, and shots can collide in mid-air.
- The mystery ship hides the original's secret score table.
- There's an extra life at 1,500 points and a top-10 table with three-letter initials.
- An attract mode shows a demo game, the score advance table and "INSERT COIN".
- Chiptune sound effects play on Windows.
- A boss key hides the game behind a fake build log.
- Try the Konami code.

![Title screen](docs/title.svg)

## Controls

| Key       | Action       |
| --------- | ------------ |
| ← → / A D | Move         |
| Space     | Fire         |
| P         | Pause        |
| M         | Sound on/off |
| B         | Boss key     |
| Q         | Quit         |

Needs a truecolor terminal of at least 80x30, such as Windows Terminal, and Node.js 18 or later.

![Entering initials for a new high score](docs/high-score.svg)
