import { homedir } from 'node:os';
import { join } from 'node:path';

export const dataDir = process.env.CLAUDE_INVADERS_HOME ?? join(homedir(), '.claude-invaders');
export const scoresPath = join(dataDir, 'scores.json');
export const signalPath = join(dataDir, 'claude-signal.json');
export const soundDir = join(dataDir, 'sfx');
