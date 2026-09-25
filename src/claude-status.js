import { mkdirSync, readFileSync, unwatchFile, watchFile, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { signalPath } from './paths.js';

export const statusEvents = ['working', 'done', 'attention'];

/** Called from Claude Code hooks: records what Claude is up to for any running game. */
export const writeStatus = (event, path = signalPath) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ event, time: Date.now() }));
};

/** Reports status changes made after the game started. Returns a function that stops watching. */
export const watchStatus = (onEvent, path = signalPath) => {
  const startedAt = Date.now();
  let lastTime = startedAt;
  const check = () => {
    try {
      const { event, time } = JSON.parse(readFileSync(path, 'utf8'));
      if (time > lastTime && statusEvents.includes(event)) {
        lastTime = time;
        onEvent(event);
      }
    } catch {
      // No hooks installed yet, or a half-written file; the next poll will catch up.
    }
  };
  watchFile(path, { interval: 400 }, check);
  return () => unwatchFile(path, check);
};
