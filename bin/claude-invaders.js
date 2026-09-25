#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { App } from '../src/app.js';
import { statusEvents, watchStatus, writeStatus } from '../src/claude-status.js';
import { loadScores, saveScores } from '../src/highscores.js';
import { createInput } from '../src/input.js';
import { startNativeHelper } from '../src/native.js';
import { createSound } from '../src/sound.js';

const scriptPath = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

const WINDOW_SIZE = '112,38';

const usage = `Claude Invaders — Space Invaders starring Clawd.

  claude-invaders             play in this terminal (opens a new window if this isn't one)
  claude-invaders --window    open in a new Windows Terminal window
  claude-invaders --tab       open in a new tab of the current Windows Terminal window
  claude-invaders --split     open in a split pane beside the current one
  claude-invaders --launch [tab|split]
                              same as the three above, defaulting to a new window
  claude-invaders --notify <${statusEvents.join('|')}>
                              tell running games what Claude is doing (for hooks)

  --mute                      start with sound off
  --no-autopause              keep playing when Claude finishes`;

const passThrough = args.filter((arg) => arg === '--mute' || arg === '--no-autopause');

const commandExists = (command) =>
  spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' }).status === 0;

const launchDetached = (command, commandArgs) => {
  const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (error) => {
    console.error(`Could not start ${command}: ${error.message}`);
    process.exitCode = 1;
  });
  child.unref();
};

const launch = (mode) => {
  const gameCommand = [process.execPath, scriptPath, ...passThrough];
  if (process.platform === 'win32') {
    if (commandExists('wt')) {
      const title = ['--title', 'Claude Invaders', '--suppressApplicationTitle'];
      const layouts = {
        window: ['-w', 'new', '--size', WINDOW_SIZE, 'new-tab', ...title],
        tab: ['-w', '0', 'new-tab', ...title],
        split: ['-w', '0', 'split-pane', '-V', '--size', '0.5', ...title],
      };
      launchDetached('wt', [...layouts[mode], ...gameCommand]);
    } else {
      launchDetached('cmd.exe', ['/c', 'start', '"Claude Invaders"', ...gameCommand.map((part) => `"${part}"`)]);
    }
  } else if (process.platform === 'darwin') {
    const shellCommand = gameCommand.map((part) => `'${part}'`).join(' ');
    launchDetached('osascript', ['-e', `tell application "Terminal" to do script "${shellCommand}"`, '-e', 'tell application "Terminal" to activate']);
  } else {
    const terminal = ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xterm'].find(commandExists);
    if (!terminal) {
      console.error('No terminal emulator found. Run claude-invaders from a terminal instead.');
      process.exitCode = 1;
      return;
    }
    launchDetached(terminal, terminal === 'gnome-terminal' ? ['--', ...gameCommand] : ['-e', ...gameCommand]);
  }
  console.log('Claude Invaders launched. Defend the codebase!');
};

const play = () => {
  const { stdin, stdout } = process;
  let helper = null;
  const input = createInput(stdin);
  helper = startNativeHelper({ onKeyMask: input.onKeyMask });
  helper?.send(`keys ${input.helperKeyCodes.join(',')}`);
  const sound = createSound(helper);
  if (has('--mute')) {
    sound.toggleMute();
  }

  const app = new App({
    write: (data) => stdout.write(data),
    size: () => ({ cols: stdout.columns || 80, rows: stdout.rows || 30 }),
    input,
    sound,
    scores: loadScores(),
    saveScores,
    autoPause: !has('--no-autopause'),
  });
  const stopWatching = watchStatus((event) => app.onClaudeStatus(event));

  let restored = false;
  const restore = () => {
    if (restored) {
      return;
    }
    restored = true;
    stopWatching();
    helper?.stop();
    if (stdin.isTTY) {
      stdin.setRawMode(false);
    }
    stdout.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[?1049l');
  };
  process.on('exit', restore);
  process.on('uncaughtException', (error) => {
    restore();
    console.error(error);
    process.exit(1);
  });

  stdout.write('\x1b]0;Claude Invaders\x07\x1b[?1049h\x1b[?25l\x1b[?7l');
  stdin.setRawMode(true);
  stdin.resume();
  stdout.on('resize', () => app.resize());

  const TICK_MS = 1000 / 60;
  let last = performance.now();
  let pending = 0;
  const loop = () => {
    const now = performance.now();
    pending += now - last;
    last = now;
    let ticks = 0;
    while (pending >= TICK_MS && ticks < 4) {
      app.tick();
      pending -= TICK_MS;
      ticks++;
    }
    if (ticks === 4) {
      pending = 0;
    }
    if (app.quitRequested) {
      restore();
      process.exit(0);
    }
    if (ticks > 0) {
      app.render();
    }
    setTimeout(loop, 2);
  };
  loop();
};

if (has('--help') || has('-h')) {
  console.log(usage);
} else if (has('--notify')) {
  const event = args[args.indexOf('--notify') + 1];
  if (statusEvents.includes(event)) {
    writeStatus(event);
  }
} else if (has('--launch')) {
  const mode = args[args.indexOf('--launch') + 1];
  launch(['tab', 'split'].includes(mode) ? mode : 'window');
} else if (has('--window')) {
  launch('window');
} else if (has('--tab')) {
  launch('tab');
} else if (has('--split')) {
  launch('split');
} else if (process.stdin.isTTY && process.stdout.isTTY) {
  play();
} else {
  launch('window');
}
