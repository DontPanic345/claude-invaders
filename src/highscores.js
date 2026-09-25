import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scoresPath } from './paths.js';

const TABLE_SIZE = 10;

const defaultScores = [
  { initials: 'CLD', score: 5000 },
  { initials: 'OPS', score: 4000 },
  { initials: 'SNT', score: 3000 },
  { initials: 'HKU', score: 2000 },
  { initials: 'ANT', score: 1000 },
];

export const loadScores = (path = scoresPath) => {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => typeof entry.score === 'number' && typeof entry.initials === 'string');
    }
  } catch {
    // First run, or an unreadable file: start from the arcade defaults.
  }
  return defaultScores.map((entry) => ({ ...entry }));
};

export const qualifies = (scores, score) =>
  score > 0 && (scores.length < TABLE_SIZE || score > scores[scores.length - 1].score);

export const insertScore = (scores, entry) =>
  [...scores, entry].sort((a, b) => b.score - a.score).slice(0, TABLE_SIZE);

export const saveScores = (scores, path = scoresPath) => {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(scores, null, 2));
  } catch {
    // A read-only home directory just means scores don't persist.
  }
};
