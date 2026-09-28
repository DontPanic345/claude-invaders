import { execFile, spawn } from 'node:child_process';
import { resolve } from 'node:path';

const samePath = (a, b) => {
  const normalize = (path) => resolve(path).replace(/[\\/]+$/, '');
  if (process.platform === 'win32') {
    return normalize(a).toLowerCase() === normalize(b).toLowerCase();
  }
  return normalize(a) === normalize(b);
};

/** Picks the newest background Claude Code session started in `cwd` from `claude agents --json` output. */
export const pickBackgroundSession = (sessions, cwd) =>
  sessions
    .filter((session) => session.kind === 'background' && session.id && samePath(session.cwd, cwd))
    .sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;

/** Resolves to the background session for `cwd`, or null when there is none or `claude` isn't available. */
export const findBackgroundSession = (cwd) =>
  new Promise((done) => {
    execFile('claude', ['agents', '--json'], { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) {
        done(null);
        return;
      }
      try {
        done(pickBackgroundSession(JSON.parse(stdout), cwd));
      } catch {
        done(null);
      }
    });
  });

/** Hands the terminal to the session until the user leaves it, then resolves. */
export const attachSession = (id) =>
  new Promise((done) => {
    const child = spawn('claude', ['attach', id], { stdio: 'inherit' });
    child.on('error', () => done());
    child.on('exit', () => done());
  });
