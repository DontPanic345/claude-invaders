import { font } from './sprites.js';

export const colors = {
  black: 0x000000,
  white: 0xf2f2f2,
  dim: 0x5a5a66,
  red: 0xff4040,
  green: 0x40ff60,
  yellow: 0xffe040,
  cyan: 0x40e0ff,
  magenta: 0xff50ff,
  orange: 0xd97757,
  orangeLight: 0xf0a080,
};

/** A pixel framebuffer; 0 means empty. Two vertical pixels share one terminal cell. */
export class Canvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Int32Array(width * height);
  }

  clear() {
    this.pixels.fill(0);
  }

  set(x, y, color) {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px >= 0 && py >= 0 && px < this.width && py < this.height) {
      this.pixels[py * this.width + px] = color;
    }
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return 0;
    }
    return this.pixels[y * this.width + x];
  }

  /** `color` is a number or a (x, y) => number function for position-dependent tints. */
  sprite(sprite, x, y, color, scale = 1) {
    const ox = Math.round(x);
    const oy = Math.round(y);
    for (let row = 0; row < sprite.height; row++) {
      for (let col = 0; col < sprite.width; col++) {
        if (!sprite.pixels[row][col]) {
          continue;
        }
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = ox + col * scale + sx;
            const py = oy + row * scale + sy;
            this.set(px, py, typeof color === 'function' ? color(px, py) : color);
          }
        }
      }
    }
  }

  /** Big pixel-font text. Returns the width in pixels. */
  bigText(text, x, y, color, scale = 1) {
    let cursor = Math.round(x);
    [...text.toUpperCase()].forEach((ch, index) => {
      const glyph = font[ch] ?? font['?'];
      const tint = typeof color === 'function' ? (px, py) => color(px, py, index) : color;
      this.sprite(glyph, cursor, y, tint, scale);
      cursor += (glyph.width + 1) * scale;
    });
    return cursor - Math.round(x) - scale;
  }
}

export const bigTextWidth = (text, scale = 1) => text.length * 4 * scale - scale;

const sgrFg = (color) => `\x1b[38;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m`;
const sgrBg = (color) => `\x1b[48;2;${(color >> 16) & 255};${(color >> 8) & 255};${color & 255}m`;

/** A cell grid the size of the terminal, flushed as a diff against the previous frame. */
export class Screen {
  constructor(write) {
    this.write = write;
    this.cols = 0;
    this.rows = 0;
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    const size = cols * rows;
    this.chars = new Array(size).fill(' ');
    this.fgs = new Int32Array(size);
    this.bgs = new Int32Array(size);
    this.prevChars = null;
  }

  begin() {
    this.chars.fill(' ');
    this.fgs.fill(colors.white);
    this.bgs.fill(colors.black);
  }

  put(x, y, ch, fg = colors.white, bg = colors.black) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) {
      return;
    }
    const index = y * this.cols + x;
    this.chars[index] = ch;
    this.fgs[index] = fg;
    this.bgs[index] = bg;
  }

  text(x, y, str, fg = colors.white, bg = colors.black) {
    [...str].forEach((ch, i) => this.put(x + i, y, ch, fg, bg));
  }

  centerText(y, str, fg, bg, left = 0, width = this.cols) {
    this.text(left + Math.floor((width - [...str].length) / 2), y, str, fg, bg);
  }

  blit(canvas, x0, y0) {
    for (let cy = 0; cy < canvas.height / 2; cy++) {
      for (let cx = 0; cx < canvas.width; cx++) {
        const top = canvas.pixels[cy * 2 * canvas.width + cx];
        const bottom = cy * 2 + 1 < canvas.height ? canvas.pixels[(cy * 2 + 1) * canvas.width + cx] : 0;
        if (!top && !bottom) {
          this.put(x0 + cx, y0 + cy, ' ');
        } else if (top && bottom) {
          if (top === bottom) {
            this.put(x0 + cx, y0 + cy, '█', top);
          } else {
            this.put(x0 + cx, y0 + cy, '▀', top, bottom);
          }
        } else if (top) {
          this.put(x0 + cx, y0 + cy, '▀', top);
        } else {
          this.put(x0 + cx, y0 + cy, '▄', bottom);
        }
      }
    }
  }

  flush() {
    const full = this.prevChars === null;
    let out = '\x1b[?2026h';
    if (full) {
      out += '\x1b[0m\x1b[48;2;0;0;0m\x1b[2J';
      this.prevChars = new Array(this.chars.length).fill(null);
      this.prevFgs = new Int32Array(this.chars.length);
      this.prevBgs = new Int32Array(this.chars.length);
    }
    let lastFg = -1;
    let lastBg = -1;
    let cursor = -1;
    for (let i = 0; i < this.chars.length; i++) {
      const ch = this.chars[i];
      const fg = this.fgs[i];
      const bg = this.bgs[i];
      const unchanged = this.prevChars[i] === ch && this.prevBgs[i] === bg && (ch === ' ' || this.prevFgs[i] === fg);
      if (unchanged) {
        continue;
      }
      if (cursor !== i) {
        out += `\x1b[${Math.floor(i / this.cols) + 1};${(i % this.cols) + 1}H`;
      }
      if (ch !== ' ' && fg !== lastFg) {
        out += sgrFg(fg);
        lastFg = fg;
      }
      if (bg !== lastBg) {
        out += sgrBg(bg);
        lastBg = bg;
      }
      out += ch;
      cursor = (i + 1) % this.cols === 0 ? -1 : i + 1;
      this.prevChars[i] = ch;
      this.prevFgs[i] = fg;
      this.prevBgs[i] = bg;
    }
    out += '\x1b[?2026l';
    this.write(out);
  }
}
