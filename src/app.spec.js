import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from './app.js';
import { insertScore, qualifies } from './highscores.js';

const fakeInput = () => {
  const queue = [];
  return {
    press: (...keys) => queue.push(...keys),
    drainEvents: () => queue.splice(0),
    actions: () => ({ left: false, right: false, fire: false }),
  };
};

const fakeSound = () => {
  let muted = false;
  const played = [];
  return {
    played,
    play: (name) => played.push(name),
    stop: () => {},
    isMuted: () => muted,
    toggleMute: () => {
      muted = !muted;
      return muted;
    },
  };
};

const createApp = ({ cols = 112, rows = 38 } = {}) => {
  let output = '';
  const input = fakeInput();
  const sound = fakeSound();
  let saved = null;
  const app = new App({
    write: (data) => {
      output += data;
    },
    size: () => ({ cols, rows }),
    input,
    sound,
    scores: [{ initials: 'CLD', score: 100 }],
    saveScores: (scores) => {
      saved = scores;
    },
  });
  const run = (ticks) => {
    for (let i = 0; i < ticks; i++) {
      app.tick();
      app.render();
    }
  };
  // Strip escape sequences so assertions can look for on-screen text.
  const visible = () => output.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
  return { app, input, sound, run, visible, saved: () => saved, clear: () => { output = ''; } };
};

test('title screen, coin, game, pause, quit, initials, saved score', () => {
  const { app, input, sound, run, visible, saved } = createApp();
  run(200);
  assert.equal(app.scene, 'title');
  assert.match(visible(), /SCORE ADVANCE TABLE/);

  input.press('space');
  run(60);
  assert.ok(sound.played.includes('coin'));
  assert.equal(app.scene, 'play');

  app.game.score = 4200;
  input.press('p');
  run(2);
  assert.ok(app.paused);
  assert.match(visible(), /PAUSED/);

  input.press('q');
  run(2);
  assert.equal(app.scene, 'initials');
  input.press('z', 'a', 'p', 'return');
  run(2);
  assert.equal(app.scene, 'title');
  assert.deepEqual(saved()[0], { initials: 'ZAP', score: 4200, wave: 1, date: saved()[0].date });
});

test('attract mode runs a demo game after the title pages', () => {
  const { app, run, input } = createApp();
  run(620 * 3);
  assert.equal(app.scene, 'demo');
  run(600);
  assert.ok(app.game.score > 0);
  input.press('x');
  run(1);
  assert.equal(app.scene, 'title');
});

test('boss key hides the game and pauses it', () => {
  const { app, input, run, visible, clear } = createApp();
  input.press('space');
  run(200);
  input.press('b');
  clear();
  run(100);
  assert.ok(app.boss);
  assert.ok(app.paused);
  assert.match(visible(), /platform-services/);
  input.press('x');
  run(1);
  assert.equal(app.boss, false);
});

test('claude finishing pauses the game and shows a banner', () => {
  const { app, input, run, visible, sound, clear } = createApp();
  input.press('space');
  run(200);
  clear();
  app.onClaudeStatus('done');
  run(2);
  assert.ok(app.paused);
  assert.ok(sound.played.includes('claudeDone'));
  assert.match(visible(), /CLAUDE HAS FINISHED/);
});

test('C pauses the game and asks to return to a background Claude session', () => {
  const { app, input, run, visible, clear } = createApp();
  input.press('space');
  run(200);
  input.press('c');
  run(1);
  assert.equal(app.returnRequested, false);
  assert.equal(app.paused, false);

  app.claudeSession = { id: 'c22e8c9a' };
  clear();
  run(2);
  assert.match(visible(), /C: CLAUDE/);
  input.press('c');
  run(1);
  assert.ok(app.returnRequested);
  assert.ok(app.paused);
});

test('C types an initial rather than returning to Claude', () => {
  const { app, input, run } = createApp();
  input.press('space');
  run(200);
  app.claudeSession = { id: 'c22e8c9a' };
  app.game.score = 4200;
  app.finishGame();
  input.press('c');
  run(1);
  assert.equal(app.returnRequested, false);
  assert.equal(app.initials[0], 'C');
});

test('konami code toggles rapid fire', () => {
  const { app, input, run } = createApp();
  input.press('up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a');
  run(1);
  assert.ok(app.rapidFire);
  assert.equal(app.boss, false);
});

test('a small terminal asks to be enlarged', () => {
  const { run, visible } = createApp({ cols: 60, rows: 20 });
  run(2);
  assert.match(visible(), /Enlarge the terminal/);
});

test('high-score table keeps the top ten', () => {
  let scores = [];
  for (let i = 1; i <= 12; i++) {
    scores = insertScore(scores, { initials: 'AAA', score: i * 100 });
  }
  assert.equal(scores.length, 10);
  assert.equal(scores[0].score, 1200);
  assert.ok(!qualifies(scores, 250));
  assert.ok(qualifies(scores, 350));
});
