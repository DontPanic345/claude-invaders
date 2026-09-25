import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot, Game } from './game.js';
import { Canvas } from './screen.js';

const seeded = (seed) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

const recordingSound = () => {
  const played = [];
  return { played, play: (name) => played.push(name), stop: () => {} };
};

test('autopilot plays several waves without errors', () => {
  const sound = recordingSound();
  const game = new Game({ width: 104, height: 64, sound, random: seeded(42) });
  const canvas = new Canvas(104, 64);
  const texts = [];
  const phases = new Set();
  for (let i = 0; i < 60 * 60 * 6 && !game.over; i++) {
    game.update(autopilot(game));
    phases.add(game.phase);
    if (i % 5 === 0) {
      game.draw(canvas, (x, y, str) => texts.push(str));
    }
  }
  assert.ok(game.score > 500, `score was ${game.score}`);
  assert.ok(phases.has('playing'));
  assert.ok(phases.has('dying') || phases.has('waveClear'));
  assert.ok(sound.played.includes('shoot'));
  assert.ok(sound.played.includes('alienHit'));
  assert.ok(sound.played.some((name) => name.startsWith('march')));
});

test('the formation fits a minimum-size field', () => {
  const game = new Game({ width: 78, height: 56, random: seeded(1) });
  const xs = game.aliens.map((alien) => alien.x);
  assert.ok(Math.min(...xs) >= 1);
  assert.ok(Math.max(...game.aliens.map((alien) => alien.x + alien.width)) <= 77);
  assert.ok(Math.max(...game.aliens.map((alien) => alien.y + 4)) < game.shieldY);
});

test('the 23rd shot scores 300 on the mystery ship', () => {
  const game = new Game({ width: 104, height: 64, random: seeded(3) });
  game.phase = 'playing';
  game.shotsFired = 22;
  game.ufo = { x: 38, dir: 0 };
  game.player.x = 38;
  game.aliens.forEach((alien) => {
    alien.alive = false;
  });
  game.aliens[0].alive = true;
  game.aliens[0].x = 2;
  game.shieldMask.fill(0);
  game.update({ left: false, right: false, fire: true });
  for (let i = 0; i < 60 && game.ufo; i++) {
    game.update({ left: false, right: false, fire: false });
  }
  assert.equal(game.ufo, null);
  assert.equal(game.score, 300);
});

test('aliens reaching the player end the game', () => {
  const game = new Game({ width: 104, height: 64, random: seeded(5) });
  game.phase = 'playing';
  game.lives = 3;
  game.aliens.forEach((alien) => {
    alien.y += game.playerY - 12;
  });
  for (let i = 0; i < 2000 && !game.over; i++) {
    game.update({ left: false, right: false, fire: false });
  }
  assert.ok(game.invaded);
  assert.ok(game.over);
});

test('an extra life is awarded once at 1500 points', () => {
  const game = new Game({ width: 104, height: 64, random: seeded(7) });
  game.addScore(1490);
  assert.equal(game.lives, 3);
  game.addScore(20);
  assert.equal(game.lives, 4);
  game.addScore(1500);
  assert.equal(game.lives, 4);
});
