import {
  alienExplosion,
  alienShots,
  alienTypes,
  clawd,
  clawdExplosion,
  playerShot,
  shield,
  shotExplosion,
  ufo as ufoSprite,
  ufoExplosion,
} from './sprites.js';
import { bigTextWidth, colors } from './screen.js';

// The arcade's mystery-ship table, indexed by shots fired: the 23rd shot and every 15th
// after it is worth 300.
const UFO_SCORES = [100, 50, 50, 100, 150, 100, 100, 50, 300, 100, 100, 100, 50, 150, 100];

const WAVE_CLEAR_LINES = [
  'ALL TESTS PASSING',
  'BUGS SQUASHED',
  'LGTM! SHIP IT!',
  'CONTEXT CLEARED',
  'NO REGRESSIONS',
  'BUILD GREEN',
  'MERGED TO MAIN',
];

const EXTRA_LIFE_SCORE = 1500;
const ALIEN_ROWS = [0, 1, 1, 2, 2];
const ALIEN_PITCH_X = 8;
const ALIEN_PITCH_Y = 5;
const ALIEN_SLOT_WIDTH = 7;

export const MIN_FIELD = { width: 78, height: 56 };

const noop = () => {};
const silentSound = { play: noop, stop: noop };

const spritePixel = (sprite, x, y) => x >= 0 && y >= 0 && x < sprite.width && y < sprite.height && sprite.pixels[y][x];

export class Game {
  constructor({ width, height, sound = silentSound, random = Math.random, highScore = 0, rapidFire = false }) {
    this.width = width;
    this.height = height;
    this.sound = sound;
    this.random = random;
    this.highScore = highScore;
    this.rapidFire = rapidFire;

    this.ufoY = 2;
    this.redZone = 8;
    this.groundY = height - 2;
    this.playerY = height - 8;
    this.shieldY = height - 17;
    this.greenZone = this.shieldY - 1;
    this.alienColumns = Math.max(6, Math.min(11, Math.floor((width - 24) / ALIEN_PITCH_X) + 1));

    this.tick = 0;
    this.score = 0;
    this.lives = 3;
    this.wave = 1;
    this.shotsFired = 0;
    this.extraLifeAwarded = false;
    this.invaded = false;
    this.over = false;
    this.popups = [];
    this.explosions = [];
    this.startWave();
  }

  startWave() {
    const formationWidth = (this.alienColumns - 1) * ALIEN_PITCH_X + ALIEN_SLOT_WIDTH;
    const startX = Math.floor((this.width - formationWidth) / 2);
    const lowestStart = this.shieldY - 4 * ALIEN_PITCH_Y - 4 - 6;
    const topY = Math.min(9 + Math.min(this.wave - 1, 5) * 2, lowestStart);

    this.aliens = [];
    ALIEN_ROWS.forEach((typeIndex, row) => {
      const type = alienTypes[typeIndex];
      const width = type.frames[0].width;
      for (let col = 0; col < this.alienColumns; col++) {
        this.aliens.push({
          type,
          col,
          row,
          width,
          x: startX + col * ALIEN_PITCH_X + Math.floor((ALIEN_SLOT_WIDTH - width) / 2),
          y: topY + row * ALIEN_PITCH_Y,
          frame: 0,
          alive: true,
        });
      }
    });
    // The arcade moves one invader per frame, starting bottom-left.
    this.marchOrder = [...this.aliens].sort((a, b) => b.row - a.row || a.col - b.col);
    this.marchDir = 1;
    this.cycle = null;
    this.marchIndex = 0;
    this.lastMarchTick = -100;
    this.stepWait = 0;
    this.freeze = 0;

    this.shieldMask = new Uint8Array(this.width * this.height);
    const shieldCount = this.width >= 96 ? 4 : 3;
    for (let i = 0; i < shieldCount; i++) {
      const sx = Math.round(((i + 1) * this.width) / (shieldCount + 1) - shield.width / 2);
      for (let row = 0; row < shield.height; row++) {
        for (let col = 0; col < shield.width; col++) {
          if (shield.pixels[row][col]) {
            this.shieldMask[(this.shieldY + row) * this.width + sx + col] = 1;
          }
        }
      }
    }
    this.ground = new Uint8Array(this.width).fill(1);

    this.player = { x: 8 };
    this.playerShots = [];
    this.alienShots = [];
    this.alienShotTimer = 90;
    this.nextShotType = 0;
    this.ufo = null;
    this.ufoTimer = 1200 + Math.floor(this.random() * 600);
    this.phase = 'ready';
    this.phaseTimer = this.wave === 1 ? 150 : 60;
    if (this.wave === 1) {
      this.sound.play('start');
    }
  }

  get aliveCount() {
    return this.aliens.filter((alien) => alien.alive).length;
  }

  update(actions) {
    this.tick++;
    this.popups = this.popups.filter((popup) => --popup.timer > 0);
    this.explosions = this.explosions.filter((explosion) => --explosion.timer > 0);

    switch (this.phase) {
      case 'ready':
        if (--this.phaseTimer <= 0) {
          this.phase = 'playing';
        }
        break;
      case 'playing':
        this.updatePlayer(actions);
        this.updatePlayerShots();
        this.updateAliens();
        this.updateAlienShots();
        this.updateUfo();
        if (this.phase === 'playing' && this.aliveCount === 0) {
          this.phase = 'waveClear';
          this.phaseTimer = 180;
          this.clearLine = WAVE_CLEAR_LINES[(this.wave - 1) % WAVE_CLEAR_LINES.length];
          this.removeUfo();
          this.sound.play('waveClear');
        }
        break;
      case 'dying':
        if (--this.phaseTimer <= 0) {
          this.lives--;
          this.alienShots = [];
          if (this.lives <= 0 || this.invaded) {
            this.lives = Math.max(0, this.lives);
            this.phase = 'gameOver';
            this.phaseTimer = 300;
            this.sound.play('gameOver');
          } else {
            this.player.x = 8;
            this.phase = 'ready';
            this.phaseTimer = 60;
          }
        }
        break;
      case 'waveClear':
        if (--this.phaseTimer <= 0) {
          this.wave++;
          this.startWave();
        }
        break;
      case 'gameOver':
        if (--this.phaseTimer <= 0) {
          this.over = true;
        }
        break;
      default:
        break;
    }
  }

  addScore(points) {
    this.score += points;
    this.highScore = Math.max(this.highScore, this.score);
    if (!this.extraLifeAwarded && this.score >= EXTRA_LIFE_SCORE) {
      this.extraLifeAwarded = true;
      this.lives++;
      this.sound.play('extraLife');
      this.popups.push({ text: '1UP!', x: this.player.x + 3, y: this.playerY - 6, color: colors.orangeLight, timer: 90 });
    }
  }

  updatePlayer({ left, right, fire }) {
    if (left && !right) {
      this.player.x = Math.max(1, this.player.x - 1);
    } else if (right && !left) {
      this.player.x = Math.min(this.width - 1 - clawd.width, this.player.x + 1);
    }
    this.fireCooldown = Math.max(0, (this.fireCooldown ?? 0) - 1);
    const maxShots = this.rapidFire ? 3 : 1;
    if (fire && this.playerShots.length < maxShots && this.fireCooldown === 0) {
      this.playerShots.push({ x: this.player.x + 5, y: this.playerY - 3 });
      this.shotsFired++;
      this.fireCooldown = this.rapidFire ? 8 : 0;
      this.sound.play('shoot');
    }
  }

  updatePlayerShots() {
    this.playerShots = this.playerShots.filter((shot) => {
      for (let step = 0; step < 2; step++) {
        shot.y -= 1;
        if (this.playerShotHits(shot)) {
          return false;
        }
      }
      return true;
    });
  }

  playerShotHits(shot) {
    if (shot.y <= 1) {
      this.explosions.push({ sprite: shotExplosion, x: shot.x - 1, y: 0, color: colors.red, timer: 12 });
      return true;
    }

    const clash = this.alienShots.find((alienShot) => this.shotsOverlap(shot, alienShot));
    if (clash) {
      this.alienShots.splice(this.alienShots.indexOf(clash), 1);
      this.explosions.push({ sprite: shotExplosion, x: shot.x - 1, y: shot.y, color: colors.white, timer: 12 });
      this.sound.play('clash');
      return true;
    }

    for (const alien of this.aliens) {
      if (!alien.alive) {
        continue;
      }
      const sprite = alien.type.frames[alien.frame];
      for (let dy = 0; dy < 3; dy++) {
        if (spritePixel(sprite, shot.x - alien.x, shot.y + dy - alien.y)) {
          alien.alive = false;
          this.addScore(alien.type.points);
          this.explosions.push({ sprite: alienExplosion, x: alien.x + Math.floor((alien.width - 7) / 2), y: alien.y, color: null, timer: 16 });
          this.freeze = 10;
          this.sound.play('alienHit');
          return true;
        }
      }
    }

    if (this.ufo && !this.ufo.hit) {
      const ux = Math.round(this.ufo.x);
      if (shot.x >= ux && shot.x < ux + ufoSprite.width && shot.y <= this.ufoY + ufoSprite.height - 1 && shot.y + 2 >= this.ufoY) {
        const points = UFO_SCORES[this.shotsFired % UFO_SCORES.length];
        this.addScore(points);
        this.sound.stop('ufo');
        this.sound.play('ufoHit');
        this.explosions.push({ sprite: ufoExplosion, x: ux, y: this.ufoY, color: colors.red, timer: 24 });
        this.popups.push({ text: String(points), x: ux + 3, y: this.ufoY, color: colors.red, timer: 100, delay: 24 });
        this.ufo = null;
        return true;
      }
    }

    for (let dy = 0; dy < 3; dy++) {
      if (this.shieldAt(shot.x, shot.y + dy)) {
        this.erodeShield(shot.x, shot.y + dy - 1);
        return true;
      }
    }
    return false;
  }

  shotsOverlap(shot, alienShot) {
    const frame = alienShots[alienShot.type][0];
    const ax = Math.round(alienShot.x);
    const ay = Math.floor(alienShot.y);
    return shot.x >= ax && shot.x < ax + frame.width && shot.y <= ay + frame.height && shot.y + 2 >= ay;
  }

  shieldAt(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return false;
    }
    return this.shieldMask[y * this.width + x] === 1;
  }

  erodeShield(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const distance = Math.abs(dx) + Math.abs(dy);
        const chance = distance <= 1 ? 1 : distance === 2 ? 0.6 : 0.2;
        const x = cx + dx;
        const y = cy + dy;
        if (this.random() < chance && x >= 0 && y >= 0 && x < this.width && y < this.height) {
          this.shieldMask[y * this.width + x] = 0;
        }
      }
    }
  }

  updateAliens() {
    if (this.freeze > 0) {
      this.freeze--;
      return;
    }
    if (this.stepWait > 0) {
      this.stepWait--;
      return;
    }
    if (!this.cycle) {
      this.beginMarchCycle();
      if (!this.cycle) {
        return;
      }
    }
    const { order } = this.cycle;
    while (this.cycle.cursor < order.length && !order[this.cycle.cursor].alive) {
      this.cycle.cursor++;
    }
    if (this.cycle.cursor < order.length) {
      const alien = order[this.cycle.cursor++];
      alien.x += this.cycle.dx;
      alien.y += this.cycle.dy;
      alien.frame ^= 1;
      for (let y = alien.y; y < alien.y + 4; y++) {
        for (let x = alien.x; x < alien.x + alien.width; x++) {
          if (this.shieldAt(x, y)) {
            this.shieldMask[y * this.width + x] = 0;
          }
        }
      }
      if (alien.y + 4 > this.playerY) {
        this.invaded = true;
        this.killPlayer();
        return;
      }
    }
    if (!order.slice(this.cycle.cursor).some((alien) => alien.alive)) {
      this.endMarchCycle();
    }
  }

  beginMarchCycle() {
    const alive = this.marchOrder.filter((alien) => alien.alive);
    if (alive.length === 0) {
      return;
    }
    const minX = Math.min(...alive.map((alien) => alien.x));
    const maxX = Math.max(...alive.map((alien) => alien.x + alien.width - 1));
    const atEdge = this.marchDir > 0 ? maxX + 1 > this.width - 2 : minX - 1 < 1;
    this.cycle = {
      order: this.marchOrder,
      cursor: 0,
      dx: atEdge ? 0 : this.marchDir,
      dy: atEdge ? 2 : 0,
      drop: atEdge,
      startTick: this.tick,
    };
  }

  endMarchCycle() {
    if (this.cycle.drop) {
      this.marchDir = -this.marchDir;
    }
    if (this.tick - this.lastMarchTick >= 7) {
      this.sound.play(`march${this.marchIndex % 4}`);
      this.marchIndex++;
      this.lastMarchTick = this.tick;
    }
    const minCycleTicks = 3;
    this.stepWait = Math.max(0, minCycleTicks - (this.tick - this.cycle.startTick) - 1);
    this.cycle = null;
  }

  updateAlienShots() {
    const alive = this.aliens.filter((alien) => alien.alive);
    const speed = Math.min(1, 0.45 + (this.wave - 1) * 0.05 + (alive.length <= 8 ? 0.1 : 0));

    this.alienShots = this.alienShots.filter((shot) => {
      shot.y += speed;
      if (this.tick % 4 === 0) {
        shot.frame = (shot.frame + 1) % alienShots[shot.type].length;
      }
      return !this.alienShotHits(shot);
    });

    if (--this.alienShotTimer > 0 || this.alienShots.length >= 3 || alive.length === 0) {
      return;
    }
    const type = this.nextShotType;
    this.nextShotType = (this.nextShotType + 1) % alienShots.length;
    const baseInterval = Math.max(14, 50 - (this.wave - 1) * 4 - Math.floor(this.score / 1000) * 2);
    this.alienShotTimer = Math.round(baseInterval * (0.7 + this.random() * 0.6));

    const columns = [...new Set(alive.map((alien) => alien.col))];
    let column;
    if (type === 2) {
      const playerCenter = this.player.x + clawd.width / 2;
      column = columns.reduce((best, col) => {
        const distance = (c) => Math.abs(this.columnCenter(c, alive) - playerCenter);
        return distance(col) < distance(best) ? col : best;
      });
    } else {
      column = columns[Math.floor(this.random() * columns.length)];
    }
    const shooter = alive.filter((alien) => alien.col === column).reduce((low, alien) => (alien.y > low.y ? alien : low));
    const frame = alienShots[type][0];
    this.alienShots.push({
      type,
      frame: 0,
      x: shooter.x + Math.floor(shooter.width / 2) - Math.floor(frame.width / 2),
      y: shooter.y + 4,
    });
  }

  columnCenter(col, alive) {
    const alien = alive.find((candidate) => candidate.col === col);
    return alien.x + alien.width / 2;
  }

  alienShotHits(shot) {
    const sprite = alienShots[shot.type][shot.frame];
    const sx = Math.round(shot.x);
    const sy = Math.floor(shot.y);

    const clash = this.playerShots.find((playerShotItem) => this.shotsOverlap(playerShotItem, shot));
    if (clash) {
      this.playerShots.splice(this.playerShots.indexOf(clash), 1);
      this.explosions.push({ sprite: shotExplosion, x: sx, y: sy, color: colors.white, timer: 12 });
      this.sound.play('clash');
      return true;
    }

    for (let row = sprite.height - 1; row >= 0; row--) {
      for (let col = 0; col < sprite.width; col++) {
        if (sprite.pixels[row][col] && this.shieldAt(sx + col, sy + row)) {
          this.erodeShield(sx + col, sy + row + 1);
          return true;
        }
      }
    }

    if (this.phase === 'playing') {
      for (let row = 0; row < sprite.height; row++) {
        for (let col = 0; col < sprite.width; col++) {
          if (sprite.pixels[row][col] && spritePixel(clawd, sx + col - this.player.x, sy + row - this.playerY)) {
            this.killPlayer();
            return true;
          }
        }
      }
    }

    if (sy + sprite.height > this.groundY) {
      for (let dx = -1; dx <= sprite.width; dx++) {
        const x = sx + dx;
        if (x >= 0 && x < this.width && this.random() < 0.7) {
          this.ground[x] = 0;
        }
      }
      this.explosions.push({ sprite: shotExplosion, x: sx, y: this.groundY - 3, color: colors.green, timer: 12 });
      return true;
    }
    return false;
  }

  killPlayer() {
    if (this.phase !== 'playing') {
      return;
    }
    this.phase = 'dying';
    this.phaseTimer = 110;
    this.playerShots = [];
    this.removeUfo();
    this.sound.play('playerDeath');
  }

  removeUfo() {
    if (this.ufo) {
      this.sound.stop('ufo');
      this.ufo = null;
    }
  }

  updateUfo() {
    if (this.ufo) {
      this.ufo.x += this.ufo.dir * 0.5;
      if (this.ufo.x < -ufoSprite.width || this.ufo.x > this.width) {
        this.removeUfo();
      }
      return;
    }
    if (--this.ufoTimer > 0) {
      return;
    }
    this.ufoTimer = 1200 + Math.floor(this.random() * 700);
    if (this.aliveCount < 8) {
      return;
    }
    const dir = this.shotsFired % 2 === 0 ? 1 : -1;
    this.ufo = { x: dir > 0 ? -ufoSprite.width : this.width, dir };
    this.sound.play('ufo');
  }

  /** Arcade cellophane overlay: red band at the top, green over the defences. */
  bandColor(y) {
    if (y < this.redZone) {
      return colors.red;
    }
    if (y >= this.greenZone) {
      return colors.green;
    }
    return colors.white;
  }

  draw(canvas, text) {
    canvas.clear();
    const band = (x, y) => this.bandColor(y);

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.shieldMask[y * this.width + x]) {
          canvas.set(x, y, colors.green);
        }
      }
    }
    for (let x = 0; x < this.width; x++) {
      if (this.ground[x]) {
        canvas.set(x, this.groundY, colors.green);
      }
    }

    for (const alien of this.aliens) {
      if (alien.alive) {
        canvas.sprite(alien.type.frames[alien.frame], alien.x, alien.y, band);
      }
    }
    if (this.ufo) {
      canvas.sprite(ufoSprite, this.ufo.x, this.ufoY, colors.red);
    }
    for (const explosion of this.explosions) {
      canvas.sprite(explosion.sprite, explosion.x, explosion.y, explosion.color ?? band);
    }

    if (this.phase === 'dying') {
      const frame = clawdExplosion[Math.floor(this.tick / 6) % 2];
      const flash = Math.floor(this.tick / 3) % 2 === 0 ? colors.orange : colors.yellow;
      canvas.sprite(frame, this.player.x, this.playerY, flash);
    } else if (this.phase !== 'gameOver') {
      const blinking = this.phase === 'ready' && Math.floor(this.tick / 8) % 2 === 0;
      if (!blinking) {
        canvas.sprite(clawd, this.player.x, this.playerY, colors.orange);
      }
    }

    for (const shot of this.playerShots) {
      canvas.sprite(playerShot, shot.x, shot.y, colors.white);
    }
    for (const shot of this.alienShots) {
      canvas.sprite(alienShots[shot.type][shot.frame], shot.x, Math.floor(shot.y), band);
    }

    for (const popup of this.popups) {
      if (!popup.delay || popup.timer < 100 - popup.delay) {
        text(Math.round(popup.x), Math.floor(popup.y / 2), popup.text, popup.color);
      }
    }

    const midRow = Math.floor(this.height / 4) + 3;
    if (this.phase === 'ready') {
      text(null, midRow, this.wave === 1 ? 'PLAYER <1>' : `WAVE ${this.wave}`, colors.white);
      text(null, midRow + 2, 'GET READY', colors.orangeLight);
    } else if (this.phase === 'waveClear') {
      text(null, midRow, `WAVE ${this.wave} CLEARED`, colors.white);
      text(null, midRow + 2, this.clearLine, colors.green);
    } else if (this.phase === 'gameOver') {
      const message = 'GAME OVER';
      const shown = Math.min(message.length, Math.floor((300 - this.phaseTimer) / 8));
      const x = Math.floor((this.width - bigTextWidth(message, 2)) / 2);
      canvas.bigText(message.slice(0, shown), x, midRow * 2 - 6, colors.red, 2);
      if (shown === message.length) {
        text(null, midRow + 5, this.invaded ? 'YOUR CODEBASE HAS BEEN INVADED' : 'CLAWD HAS FALLEN', colors.orangeLight);
      }
    }
  }
}

/** Autopilot for the attract-mode demo (and the smoke tests). */
export const autopilot = (game) => {
  const playerCenter = game.player.x + clawd.width / 2;
  const threat = game.alienShots.find(
    (shot) => Math.abs(shot.x + 1 - playerCenter) < clawd.width / 2 + 3 && shot.y > game.playerY - 28,
  );
  if (threat) {
    const goLeft = threat.x + 1 > playerCenter ? game.player.x > 3 : game.player.x > game.width - clawd.width - 4;
    return { left: goLeft, right: !goLeft, fire: false };
  }
  const alive = game.aliens.filter((alien) => alien.alive);
  if (alive.length === 0) {
    return { left: false, right: false, fire: false };
  }
  const target = alive.reduce((best, alien) => {
    const score = Math.abs(alien.x + alien.width / 2 - playerCenter) - alien.y * 0.5;
    const bestScore = Math.abs(best.x + best.width / 2 - playerCenter) - best.y * 0.5;
    return score < bestScore ? alien : best;
  });
  const targetX = target.x + target.width / 2 - 0.5;
  const shotX = game.player.x + 5;
  return {
    left: targetX < shotX - 0.5,
    right: targetX > shotX + 0.5,
    fire: Math.abs(targetX - shotX) <= 2,
  };
};
