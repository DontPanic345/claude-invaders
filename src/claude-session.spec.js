import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickBackgroundSession } from './claude-session.js';

const cwd = process.platform === 'win32' ? 'D:\\lab\\claude-invaders' : '/lab/claude-invaders';

test('picks the newest background session in this directory', () => {
  const sessions = [
    { kind: 'interactive', cwd, startedAt: 30, sessionId: 'live' },
    { kind: 'background', id: 'old', cwd, startedAt: 10 },
    { kind: 'background', id: 'new', cwd: `${cwd}${process.platform === 'win32' ? '\\' : '/'}`, startedAt: 20 },
    { kind: 'background', id: 'elsewhere', cwd: `${cwd}-other`, startedAt: 40 },
  ];
  assert.equal(pickBackgroundSession(sessions, cwd).id, 'new');
});

test('no background session in this directory gives null', () => {
  assert.equal(pickBackgroundSession([{ kind: 'interactive', cwd, startedAt: 1 }], cwd), null);
});
