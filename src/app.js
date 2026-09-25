import { autopilot, Game, MIN_FIELD } from './game.js';
import { insertScore, qualifies } from './highscores.js';
import { bigTextWidth, Canvas, colors, Screen } from './screen.js';
import { alienTypes, clawd, ufo as ufoSprite } from './sprites.js';
import { bossLines } from './boss.js';

const MAX_FIELD = { width: 110, height: 72 };
const KONAMI = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a'];
const TITLE_PAGE_TICKS = 600;
const DEMO_TICKS = 60 * 60;
const SHIMMER = [0xd97757, 0xe08466, 0xe8906f, 0xf0a080, 0xffc0a0, 0xf0a080, 0xe8906f, 0xe08466];
const SPINNER = ['|', '/', '-', '\\'];
const MINI_CLAWD = '▐▛██▜▌';

const pad = (value, length = 5) => String(value).padStart(length, '0');

/**
 * Everything above the game rules: scenes, HUD, and terminal layout. It never touches
 * process globals, so tests can drive it with a fake terminal.
 */
export class App {
  constructor({ write, size, input, sound, scores, saveScores, autoPause = true }) {
    this.screen = new Screen(write);
    this.size = size;
    this.input = input;
    this.sound = sound;
    this.scores = scores;
    this.saveScores = saveScores;
    this.autoPause = autoPause;

    this.tickCount = 0;
    this.credits = 0;
    this.rapidFire = false;
    this.konamiProgress = 0;
    this.claudeStatus = null;
    this.banner = null;
    this.paused = false;
    this.boss = false;
    this.quitRequested = false;
    this.highlightRank = -1;
    this.game = null;
    this.resize();
    this.enterTitle();
  }

  resize() {
    const { cols, rows } = this.size();
    this.screen.resize(cols, rows);
    if (!this.game) {
      this.fieldWidth = Math.max(MIN_FIELD.width, Math.min(MAX_FIELD.width, cols - 2));
      this.fieldHeight = Math.max(MIN_FIELD.height, Math.min(MAX_FIELD.height, (rows - 2) * 2));
      this.fieldHeight -= this.fieldHeight % 2;
      this.canvas = new Canvas(this.fieldWidth, this.fieldHeight);
    }
  }

  get tooSmall() {
    return this.screen.cols < this.fieldWidth + 2 || this.screen.rows < this.fieldHeight / 2 + 2;
  }

  highScore() {
    return Math.max(this.scores[0]?.score ?? 0, this.game?.score ?? 0);
  }

  enterTitle(page = 0) {
    this.scene = 'title';
    this.sceneTick = 0;
    this.titlePage = page;
    this.game = null;
    this.resize();
  }

  startGame() {
    this.credits = Math.max(0, this.credits - 1);
    this.resize();
    this.game = new Game({
      width: this.fieldWidth,
      height: this.fieldHeight,
      sound: this.sound,
      highScore: this.scores[0]?.score ?? 0,
      rapidFire: this.rapidFire,
    });
    this.scene = 'play';
    this.sceneTick = 0;
    this.paused = false;
  }

  startDemo() {
    this.resize();
    const silent = { play: () => {}, stop: () => {} };
    this.game = new Game({ width: this.fieldWidth, height: this.fieldHeight, sound: silent, highScore: this.highScore() });
    this.scene = 'demo';
    this.sceneTick = 0;
  }

  setPaused(paused) {
    if (this.scene !== 'play' || this.paused === paused) {
      return;
    }
    this.paused = paused;
    if (paused) {
      this.sound.stop('ufo');
    } else if (this.game?.ufo) {
      this.sound.play('ufo');
    }
  }

  onClaudeStatus(event) {
    this.claudeStatus = { event, since: this.tickCount };
    if (event === 'working') {
      return;
    }
    const done = event === 'done';
    this.banner = {
      title: done ? '* CLAUDE HAS FINISHED *' : '* CLAUDE NEEDS YOUR INPUT *',
      color: done ? colors.green : colors.yellow,
      until: this.tickCount + 60 * 6,
    };
    this.sound.play(done ? 'claudeDone' : 'claudeNeedsYou');
    if (this.autoPause && this.scene === 'play' && this.game?.phase !== 'gameOver') {
      this.setPaused(true);
    }
  }

  tick() {
    this.tickCount++;
    this.sceneTick++;
    const events = this.input.drainEvents();
    if (events.includes('quit')) {
      this.quitRequested = true;
      return;
    }
    // A 'b' that advances the Konami code shouldn't also open the boss screen.
    const sceneEvents = events.filter((event) => !(this.trackKonami(event) && event === 'b'));
    for (const event of sceneEvents) {
      if (event === 'm' && this.scene !== 'initials') {
        this.sound.toggleMute?.();
      }
    }

    if (this.boss) {
      if (sceneEvents.length > 0) {
        this.boss = false;
      }
      return;
    }

    switch (this.scene) {
      case 'title':
        this.tickTitle(sceneEvents);
        break;
      case 'coin':
        if (this.sceneTick > 50) {
          this.startGame();
        }
        break;
      case 'demo':
        this.tickDemo(sceneEvents);
        break;
      case 'play':
        this.tickPlay(sceneEvents);
        break;
      case 'initials':
        this.tickInitials(sceneEvents);
        break;
      default:
        break;
    }
  }

  /** Returns whether the event advanced the code. */
  trackKonami(event) {
    if (event === KONAMI[this.konamiProgress]) {
      this.konamiProgress++;
      if (this.konamiProgress === KONAMI.length) {
        this.konamiProgress = 0;
        this.rapidFire = !this.rapidFire;
        this.sound.play('extraLife');
        this.banner = {
          title: this.rapidFire ? 'RAPID FIRE UNLOCKED' : 'RAPID FIRE OFF',
          color: colors.magenta,
          until: this.tickCount + 180,
        };
      }
      return true;
    }
    this.konamiProgress = event === KONAMI[0] ? 1 : 0;
    return false;
  }

  tickTitle(events) {
    for (const event of events) {
      if (event === 'space' || event === 'return') {
        this.credits++;
        this.sound.play('coin');
        this.scene = 'coin';
        this.sceneTick = 0;
        return;
      }
      if (event === 'q' || event === 'escape') {
        this.quitRequested = true;
        return;
      }
      if (event === 'b') {
        this.boss = true;
        this.bossStart = this.tickCount;
      }
      if (event === 'right' || event === 'tab') {
        this.titlePage = (this.titlePage + 1) % 3;
        this.sceneTick = 0;
      }
    }
    if (this.sceneTick > TITLE_PAGE_TICKS) {
      if (this.titlePage === 2) {
        this.startDemo();
      } else {
        this.titlePage++;
        this.sceneTick = 0;
      }
    }
  }

  tickDemo(events) {
    if (events.includes('space') || events.includes('return')) {
      this.credits++;
      this.sound.play('coin');
      this.scene = 'coin';
      this.sceneTick = 0;
      return;
    }
    if (events.length > 0) {
      this.enterTitle();
      return;
    }
    this.game.update(autopilot(this.game));
    if (this.game.over || this.sceneTick > DEMO_TICKS) {
      this.enterTitle(1);
    }
  }

  tickPlay(events) {
    for (const event of events) {
      if (event === 'p') {
        this.setPaused(!this.paused);
      } else if (event === 'b') {
        this.setPaused(true);
        this.boss = true;
        this.bossStart = this.tickCount;
        return;
      } else if (event === 'q' || event === 'escape') {
        if (this.paused) {
          this.sound.stop('ufo');
          this.finishGame();
          return;
        }
        this.setPaused(true);
      } else if (this.paused && (event === 'space' || event === 'return')) {
        this.setPaused(false);
      }
    }
    if (this.tooSmall) {
      this.setPaused(true);
    }
    if (this.paused) {
      this.input.actions();
      return;
    }
    this.game.update(this.input.actions());
    if (this.game.over) {
      this.finishGame();
    }
  }

  finishGame() {
    const { score, wave } = this.game;
    if (qualifies(this.scores, score)) {
      this.scene = 'initials';
      this.sceneTick = 0;
      this.initials = ['A', 'A', 'A'];
      this.initialsCursor = 0;
      this.pendingScore = { score, wave };
      this.sound.play('highScore');
    } else {
      this.enterTitle(1);
    }
  }

  tickInitials(events) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (const event of events) {
      const current = letters.indexOf(this.initials[this.initialsCursor]);
      if (event === 'up' || event === 'down') {
        const delta = event === 'up' ? 1 : -1;
        this.initials[this.initialsCursor] = letters[(current + delta + letters.length) % letters.length];
        this.sound.play('blip');
      } else if (event === 'left' || event === 'backspace') {
        this.initialsCursor = Math.max(0, this.initialsCursor - 1);
      } else if (event === 'right') {
        this.initialsCursor = Math.min(2, this.initialsCursor + 1);
      } else if (event.length === 1 && letters.includes(event.toUpperCase())) {
        this.initials[this.initialsCursor] = event.toUpperCase();
        this.sound.play('blip');
        if (this.initialsCursor < 2) {
          this.initialsCursor++;
        }
      } else if (event === 'space' || event === 'return') {
        if (this.initialsCursor < 2 && event === 'space') {
          this.initialsCursor++;
        } else {
          const entry = { initials: this.initials.join(''), ...this.pendingScore, date: new Date().toISOString().slice(0, 10) };
          this.scores = insertScore(this.scores, entry);
          this.highlightRank = this.scores.indexOf(entry);
          this.saveScores(this.scores);
          this.enterTitle(1);
          return;
        }
      }
    }
  }

  // ---------------------------------------------------------------- rendering

  render() {
    const { screen } = this;
    screen.begin();
    if (this.boss) {
      this.renderBoss();
      screen.flush();
      return;
    }
    if (this.tooSmall) {
      this.renderTooSmall();
      screen.flush();
      return;
    }

    const width = this.game ? this.game.width : this.fieldWidth;
    const height = this.game ? this.game.height : this.fieldHeight;
    const x0 = Math.floor((screen.cols - width - 2) / 2) + 1;
    const y0 = Math.floor((screen.rows - height / 2 - 2) / 2) + 1;
    const overlays = [];
    const text = (x, y, str, color = colors.white) => overlays.push({ x, y, str, color });

    if (this.game && (this.scene === 'play' || this.scene === 'demo')) {
      this.game.draw(this.canvas, text);
    } else {
      this.drawTitle(text);
    }
    screen.blit(this.canvas, x0, y0);
    for (const { x, y, str, color } of overlays) {
      const left = x === null ? x0 + Math.floor((width - [...str].length) / 2) : x0 + x;
      screen.text(left, y0 + y, str, color);
    }
    for (let row = 0; row < height / 2; row++) {
      screen.put(x0 - 1, y0 + row, '│', colors.dim);
      screen.put(x0 + width, y0 + row, '│', colors.dim);
    }

    this.renderHud(x0, y0 - 1, width);
    this.renderFooter(x0, y0 + height / 2, width);
    this.renderOverlays(x0, y0, width, height);
    screen.flush();
  }

  renderHud(x, y, width) {
    const { screen } = this;
    const score = this.game ? this.game.score : 0;
    const blinkScore = this.game?.phase === 'ready' && this.game.wave === 1 && Math.floor(this.tickCount / 10) % 2 === 0;
    screen.text(x, y, 'SCORE<1>', colors.dim);
    if (!blinkScore) {
      screen.text(x + 9, y, pad(score), colors.white);
    }
    const hi = `HI-SCORE ${pad(this.highScore())}`;
    screen.text(x + Math.floor((width - hi.length) / 2), y, 'HI-SCORE', colors.dim);
    screen.text(x + Math.floor((width - hi.length) / 2) + 9, y, pad(this.highScore()), colors.yellow);
    const wave = this.game ? `WAVE ${pad(this.game.wave, 2)}` : 'CLAUDE CODE';
    screen.text(x + width - wave.length, y, wave, this.game ? colors.white : colors.orange);
  }

  renderFooter(x, y, width) {
    const { screen } = this;
    if (this.game && (this.scene === 'play' || this.scene === 'demo')) {
      const lives = this.game.lives;
      screen.text(x, y, String(lives), colors.white);
      for (let i = 0; i < Math.min(lives - 1, 5); i++) {
        screen.text(x + 2 + i * 7, y, MINI_CLAWD, colors.orange);
      }
    }
    const credit = `CREDIT ${pad(this.credits, 2)}`;
    screen.text(x + width - credit.length, y, credit, colors.white);

    const status = this.statusText();
    if (status) {
      screen.centerText(y, status.text, status.color, colors.black, x, width);
    }
  }

  statusText() {
    const blink = Math.floor(this.tickCount / 20) % 2 === 0;
    const muted = this.sound.isMuted?.() ? ' [MUTED]' : '';
    if (this.claudeStatus) {
      const { event } = this.claudeStatus;
      if (event === 'working') {
        return { text: `CLAUDE: WORKING ${SPINNER[Math.floor(this.tickCount / 8) % 4]}${muted}`, color: colors.orange };
      }
      if (event === 'done') {
        return { text: blink ? `CLAUDE: DONE!${muted}` : `             ${muted}`, color: colors.green };
      }
      return { text: blink ? `CLAUDE: NEEDS YOU${muted}` : `                 ${muted}`, color: colors.yellow };
    }
    if (this.scene === 'play') {
      return { text: `P PAUSE  M SOUND  B BOSS${muted}`, color: colors.dim };
    }
    return muted ? { text: muted.trim(), color: colors.dim } : null;
  }

  renderOverlays(x0, y0, width, height) {
    const { screen } = this;
    const midRow = y0 + Math.floor(height / 4);
    if (this.scene === 'play' && this.paused) {
      const lines = ['             ', '   PAUSED    ', '             '];
      lines.forEach((line, i) => screen.centerText(midRow - 2 + i, line, colors.black, colors.white, x0, width));
      screen.centerText(midRow + 2, ' P / SPACE RESUME   Q QUIT GAME ', colors.white, colors.black, x0, width);
    }
    if (this.scene === 'demo') {
      if (Math.floor(this.tickCount / 30) % 2 === 0) {
        screen.centerText(y0 + 5, ' DEMO PLAY ', colors.black, colors.orange, x0, width);
      }
      screen.centerText(y0 + height / 2 - 3, ' PRESS SPACE TO PLAY ', colors.white, colors.black, x0, width);
    }
    if (this.banner && this.tickCount < this.banner.until) {
      const flash = Math.floor(this.tickCount / 6) % 2 === 0;
      const title = ` ${this.banner.title} `;
      const bar = ' '.repeat(title.length);
      screen.centerText(midRow - 5, bar, colors.black, flash ? this.banner.color : colors.white, x0, width);
      screen.centerText(midRow - 4, title, colors.black, flash ? this.banner.color : colors.white, x0, width);
      screen.centerText(midRow - 3, bar, colors.black, flash ? this.banner.color : colors.white, x0, width);
    }
  }

  drawTitle(text) {
    const canvas = this.canvas;
    const { width, height } = canvas;
    canvas.clear();
    const extraRows = Math.max(0, Math.floor((height / 2 - 28) / 2));
    const top = extraRows * 2;
    const shimmer = (px, py, index) => SHIMMER[(index + Math.floor(this.tickCount / 5)) % SHIMMER.length];

    if (this.scene === 'coin') {
      text(null, top / 2 + 10, `CREDIT ${pad(this.credits, 2)}`, colors.white);
      text(null, top / 2 + 13, 'PUSH START', colors.orangeLight);
      canvas.sprite(clawd, Math.floor((width - clawd.width) / 2), top + 36, colors.orange);
      return;
    }
    if (this.scene === 'initials') {
      this.drawInitials(text, top);
      return;
    }

    canvas.bigText('CLAUDE', Math.floor((width - bigTextWidth('CLAUDE', 2)) / 2), top + 2, shimmer, 2);
    canvas.bigText('INVADERS', Math.floor((width - bigTextWidth('INVADERS', 2)) / 2), top + 14, shimmer, 2);

    // Clawd patrols under the logo, chased by an invader.
    const span = width - clawd.width - 16;
    const t = (this.tickCount / 2) % (span * 2);
    const walkX = 8 + (t < span ? t : span * 2 - t);
    const facingRight = t < span;
    canvas.sprite(clawd, walkX, top + 27, colors.orange);
    const chaser = alienTypes[1].frames[Math.floor(this.tickCount / 15) % 2];
    const chaserX = facingRight ? walkX - 14 : walkX + clawd.width + 7;
    canvas.sprite(chaser, chaserX, top + 28, colors.white);

    const row = top / 2 + 17;
    if (this.titlePage === 0) {
      this.drawScoreTable(text, row);
    } else if (this.titlePage === 1) {
      this.drawHighScores(text, row);
    } else {
      this.drawHowToPlay(text, row);
    }

    const promptRow = Math.min(height / 2 - 1, row + 10);
    if (Math.floor(this.tickCount / 25) % 2 === 0) {
      text(null, promptRow, this.credits > 0 ? 'PUSH START' : 'PRESS SPACE TO PLAY', colors.white);
    } else {
      text(null, promptRow, 'INSERT COIN', colors.dim);
    }
  }

  typed(str, startTick) {
    const shown = Math.max(0, Math.floor((this.sceneTick - startTick) / 4));
    return str.slice(0, shown);
  }

  drawScoreTable(text, row) {
    const canvas = this.canvas;
    text(null, row, this.typed('*SCORE ADVANCE TABLE*', 0), colors.white);
    const entries = [
      { sprite: ufoSprite, label: '= ? MYSTERY', color: colors.red },
      { sprite: alienTypes[0].frames[0], label: '= 30 POINTS', color: colors.white },
      { sprite: alienTypes[1].frames[0], label: '= 20 POINTS', color: colors.white },
      { sprite: alienTypes[2].frames[0], label: '= 10 POINTS', color: colors.green },
    ];
    const left = Math.floor(canvas.width / 2) - 10;
    entries.forEach((entry, index) => {
      const cellRow = row + 2 + index * 2;
      const start = 90 + index * 60;
      if (this.sceneTick < start) {
        return;
      }
      canvas.sprite(entry.sprite, left + 5 - Math.floor(entry.sprite.width / 2), cellRow * 2, entry.color);
      text(left + 12, cellRow, this.typed(entry.label, start), entry.color);
    });
  }

  drawHighScores(text, row) {
    text(null, row, '*  HIGH SCORES  *', colors.yellow);
    const half = Math.ceil(this.scores.length / 2);
    const columnWidth = 18;
    const left = Math.floor(this.canvas.width / 2) - columnWidth;
    this.scores.forEach((entry, index) => {
      const column = index < half ? 0 : 1;
      const line = `${String(index + 1).padStart(2)}. ${entry.initials} ${pad(entry.score)}`;
      const highlighted = index === this.highlightRank && Math.floor(this.tickCount / 10) % 2 === 0;
      text(left + column * (columnWidth + 2), row + 2 + (index % half), line, highlighted ? colors.orange : colors.white);
    });
  }

  drawHowToPlay(text, row) {
    const lines = [
      ['< >  A D', 'MOVE CLAWD'],
      ['SPACE', 'FIRE'],
      ['P', 'PAUSE'],
      ['M', 'SOUND ON/OFF'],
      ['B', 'BOSS KEY'],
      ['Q', 'QUIT'],
    ];
    text(null, row, '*  HOW TO PLAY  *', colors.cyan);
    const left = Math.floor(this.canvas.width / 2) - 12;
    lines.forEach(([keys, action], index) => {
      text(left, row + 2 + index, keys.padEnd(10), colors.yellow);
      text(left + 11, row + 2 + index, action, colors.white);
    });
  }

  drawInitials(text, top) {
    const canvas = this.canvas;
    const row = top / 2 + 3;
    text(null, row, 'NEW HIGH SCORE!', colors.yellow);
    text(null, row + 2, pad(this.pendingScore.score), colors.white);
    text(null, row + 4, 'ENTER YOUR INITIALS', colors.orangeLight);
    const scale = 3;
    const glyphWidth = 4 * scale;
    const startX = Math.floor((canvas.width - glyphWidth * 3) / 2);
    this.initials.forEach((letter, index) => {
      const active = index === this.initialsCursor;
      const visible = !active || Math.floor(this.tickCount / 12) % 2 === 0;
      if (visible) {
        canvas.bigText(letter, startX + index * glyphWidth, (row + 7) * 2, active ? colors.orange : colors.white, scale);
      }
      for (let x = 0; x < 3 * scale; x++) {
        canvas.set(startX + index * glyphWidth + x, (row + 7) * 2 + 5 * scale + 2, active ? colors.orange : colors.dim);
      }
    });
    text(null, row + 17, 'TYPE OR USE ARROWS, ENTER TO SAVE', colors.dim);
  }

  renderBoss() {
    const { screen } = this;
    const elapsed = Math.floor((this.tickCount - this.bossStart) / 7);
    const visible = bossLines.slice(0, Math.min(bossLines.length, elapsed + 3));
    const start = Math.max(0, visible.length - (screen.rows - 1));
    const gray = 0xcccccc;
    visible.slice(start).forEach((line, index) => screen.text(0, index, line.slice(0, screen.cols), line.startsWith('$') ? 0x6fdc6f : gray));
    if (Math.floor(this.tickCount / 30) % 2 === 0) {
      const lastLine = visible[visible.length - 1];
      screen.put(lastLine.length, visible.length - start - 1, '█', gray);
    }
  }

  renderTooSmall() {
    const { screen } = this;
    const needCols = this.fieldWidth + 2;
    const needRows = this.fieldHeight / 2 + 2;
    const mid = Math.floor(screen.rows / 2);
    screen.centerText(mid - 1, 'CLAUDE INVADERS', colors.orange);
    screen.centerText(mid, `Enlarge the terminal to ${needCols}x${needRows}`, colors.white);
    screen.centerText(mid + 1, `(now ${screen.cols}x${screen.rows})`, colors.dim);
  }
}
