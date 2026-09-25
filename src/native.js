import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './paths.js';

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'native', 'helper.cs');
const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const buildHelper = () => {
  const source = readFileSync(sourcePath);
  const hash = createHash('sha1').update(source).digest('hex').slice(0, 10);
  const exePath = join(dataDir, `helper-${hash}.exe`);
  if (existsSync(exePath)) {
    return exePath;
  }
  if (!existsSync(cscPath)) {
    return null;
  }
  mkdirSync(dataDir, { recursive: true });
  const result = spawnSync(cscPath, ['/nologo', '/optimize', '/target:exe', `/out:${exePath}`, sourcePath], {
    windowsHide: true,
    encoding: 'utf8',
  });
  return result.status === 0 && existsSync(exePath) ? exePath : null;
};

/**
 * Starts the Windows helper process. Returns null anywhere it can't run, in which case
 * the game falls back to press-only input and silence.
 */
export const startNativeHelper = ({ onKeyMask, onError } = {}) => {
  if (process.platform !== 'win32') {
    return null;
  }
  let exePath;
  try {
    exePath = buildHelper();
  } catch {
    return null;
  }
  if (!exePath) {
    return null;
  }

  const child = spawn(exePath, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  let alive = true;
  let pending = '';
  child.on('error', () => {
    alive = false;
  });
  child.on('exit', () => {
    alive = false;
  });
  child.stdin.on('error', () => {
    alive = false;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line.startsWith('K ')) {
        onKeyMask?.(Number(line.slice(2)));
      } else if (line.startsWith('E ')) {
        onError?.(line.slice(2));
      }
    }
  });

  const send = (line) => {
    if (alive) {
      child.stdin.write(`${line}\n`);
    }
  };

  return {
    send,
    isAlive: () => alive,
    stop: () => {
      send('quit');
      child.stdin.end();
      setTimeout(() => child.kill(), 300).unref();
    },
  };
};
