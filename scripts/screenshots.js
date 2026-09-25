// Renders README screenshots straight from the game's frame buffer: node scripts/screenshots.js
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from '../src/app.js';
import { autopilot } from '../src/game.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const COLS = 112;
const ROWS = 38;
const CELL_W = 10;
const CELL_H = 20;
const PAD = 16;
const TITLE_BAR = 30;

let seed = 20260925;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

// Which quadrants (UL, UR, LL, LR) each block character fills.
const quadrants = {
  '█': [1, 1, 1, 1],
  '▀': [1, 1, 0, 0],
  '▄': [0, 0, 1, 1],
  '▌': [1, 0, 1, 0],
  '▐': [0, 1, 0, 1],
  '▛': [1, 1, 1, 0],
  '▜': [1, 1, 0, 1],
  '▙': [1, 0, 1, 1],
  '▟': [0, 1, 1, 1],
  '▘': [1, 0, 0, 0],
  '▝': [0, 1, 0, 0],
  '▖': [0, 0, 1, 0],
  '▗': [0, 0, 0, 1],
};

const hex = (color) => `#${color.toString(16).padStart(6, '0')}`;
const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const toSvg = (screen, title) => {
  const width = COLS * CELL_W + PAD * 2;
  const height = ROWS * CELL_H + PAD * 2 + TITLE_BAR;
  const ox = PAD;
  const oy = PAD + TITLE_BAR;
  const parts = [];

  // Two sub-rows per cell row, each two sub-columns wide, run-length merged into rects.
  for (let row = 0; row < ROWS; row++) {
    for (let half = 0; half < 2; half++) {
      let runColor = null;
      let runStart = 0;
      const flush = (end) => {
        if (runColor !== null && runColor !== 0) {
          parts.push(`<rect x="${ox + (runStart * CELL_W) / 2}" y="${oy + row * CELL_H + (half * CELL_H) / 2}" width="${((end - runStart) * CELL_W) / 2}" height="${CELL_H / 2}" fill="${hex(runColor)}"/>`);
        }
      };
      for (let sub = 0; sub <= COLS * 2; sub++) {
        let color = null;
        if (sub < COLS * 2) {
          const index = row * COLS + Math.floor(sub / 2);
          const fill = quadrants[screen.chars[index]];
          color = fill && fill[half * 2 + (sub % 2)] ? screen.fgs[index] : screen.bgs[index];
        }
        if (color !== runColor) {
          flush(sub);
          runColor = color;
          runStart = sub;
        }
      }
    }
  }

  for (let row = 0; row < ROWS; row++) {
    let col = 0;
    while (col < COLS) {
      const index = row * COLS + col;
      const ch = screen.chars[index];
      if (ch === '│') {
        parts.push(`<rect x="${ox + col * CELL_W + CELL_W / 2 - 0.75}" y="${oy + row * CELL_H}" width="1.5" height="${CELL_H}" fill="${hex(screen.fgs[index])}"/>`);
        col++;
        continue;
      }
      if (ch === ' ' || quadrants[ch]) {
        col++;
        continue;
      }
      let end = col;
      let text = '';
      while (end < COLS) {
        const next = screen.chars[row * COLS + end];
        const sameColor = screen.fgs[row * COLS + end] === screen.fgs[index];
        if (quadrants[next] || next === '│' || (next !== ' ' && !sameColor)) {
          break;
        }
        text += next;
        end++;
      }
      const trimmed = text.trimEnd();
      parts.push(`<text x="${ox + col * CELL_W}" y="${oy + row * CELL_H + 15}" fill="${hex(screen.fgs[index])}" textLength="${trimmed.length * CELL_W}" lengthAdjust="spacingAndGlyphs">${escapeXml(trimmed)}</text>`);
      col += trimmed.length;
      col = Math.max(col, index % COLS + 1);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="${width}" height="${height}" rx="10" fill="#000"/>
<rect width="${width}" height="${TITLE_BAR}" rx="10" fill="#1f1f24"/>
<rect y="${TITLE_BAR - 10}" width="${width}" height="10" fill="#1f1f24"/>
<circle cx="20" cy="15" r="6" fill="#ff5f57"/><circle cx="40" cy="15" r="6" fill="#febc2e"/><circle cx="60" cy="15" r="6" fill="#28c840"/>
<text x="${width / 2}" y="20" fill="#9a9aa6" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="13" text-anchor="middle">${escapeXml(title)}</text>
<g font-family="Consolas, Menlo, 'DejaVu Sans Mono', monospace" font-size="16" font-weight="bold" xml:space="preserve">
${parts.join('\n')}
</g>
</svg>
`;
};

const createApp = () => {
  const queue = [];
  const input = {
    press: (...keys) => queue.push(...keys),
    drainEvents: () => queue.splice(0),
    actions: () => (app.game ? autopilot(app.game) : { left: false, right: false, fire: false }),
  };
  const sound = { play: () => {}, stop: () => {}, isMuted: () => false, toggleMute: () => false };
  const app = new App({
    write: () => {},
    size: () => ({ cols: COLS, rows: ROWS }),
    input,
    sound,
    scores: [
      { initials: 'CLD', score: 5000 },
      { initials: 'OPS', score: 4000 },
      { initials: 'SNT', score: 3000 },
      { initials: 'HKU', score: 2000 },
      { initials: 'ANT', score: 1000 },
    ],
    saveScores: () => {},
  });
  const run = (ticks, until = () => false) => {
    for (let i = 0; i < ticks; i++) {
      app.tick();
      if (until()) {
        break;
      }
    }
    app.render();
  };
  return { app, input, run };
};

const shots = [];
const capture = (app, name, title) => {
  app.render();
  shots.push({ name, svg: toSvg(app.screen, title) });
};

{
  const { app, run } = createApp();
  run(460);
  capture(app, 'title', 'Claude Invaders');
}

{
  const { app, input, run } = createApp();
  input.press('space');
  run(60);
  app.onClaudeStatus('working');
  run(3000, () => app.game.aliens.filter((alien) => !alien.alive).length > 12);
  app.game.ufoTimer = 1;
  run(600, () => {
    const game = app.game;
    const killed = game.aliens.filter((alien) => !alien.alive).length;
    return killed > 10 && game.ufo && game.ufo.x > 20 && game.ufo.x < 80 && game.alienShots.length >= 1 && game.phase === 'playing';
  });
  capture(app, 'gameplay', 'Claude Invaders: Claude is working');

  run(200, () => app.game.explosions.length > 0 && app.game.phase === 'playing');
  app.onClaudeStatus('done');
  run(1);
  capture(app, 'claude-done', 'Claude Invaders: Claude has finished');
}

{
  const { app, input, run } = createApp();
  input.press('space');
  run(60);
  app.game.score = 4270;
  input.press('q');
  run(2);
  input.press('q');
  run(2);
  input.press('z', 'a');
  run(20);
  capture(app, 'high-score', 'Claude Invaders: new high score');
}

mkdirSync(outDir, { recursive: true });
for (const { name, svg } of shots) {
  writeFileSync(join(outDir, `${name}.svg`), svg);
  console.log(`docs/${name}.svg  ${(svg.length / 1024).toFixed(0)} KB`);
}
