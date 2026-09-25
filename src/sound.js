import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { soundDir } from './paths.js';

const RATE = 22050;
const SYNTH_VERSION = 2;

const square = (freq, t) => (Math.sin(2 * Math.PI * freq * t) >= 0 ? 1 : -1);

// Sample-and-hold noise, the way the arcade's discrete noise circuit sounds.
const makeNoise = (seed = 1) => {
  let state = seed;
  let held = 0;
  let lastStep = -1;
  return (freq, t) => {
    const step = Math.floor(t * freq);
    if (step !== lastStep) {
      lastStep = step;
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      held = (state / 0x3fffffff) - 1;
    }
    return held;
  };
};

const melody = (notes, { duty = 0.5, volume = 0.5 } = {}) => {
  const starts = [];
  let total = 0;
  for (const [freq, length] of notes) {
    starts.push([total, freq, length]);
    total += length;
  }
  return {
    duration: total,
    sample: (t) => {
      const note = starts.find(([start, , length]) => t >= start && t < start + length);
      if (!note || note[1] === 0) {
        return 0;
      }
      const [start, freq, length] = note;
      const local = t - start;
      const phase = (freq * t) % 1;
      const env = Math.min(1, local * 200) * (1 - (local / length) * 0.6);
      return (phase < duty ? 1 : -1) * volume * env;
    },
  };
};

const shootNoise = makeNoise(7);
const hitNoise = makeNoise(11);
const deathNoise = makeNoise(13);
const clashNoise = makeNoise(17);

const marchNote = (freq) => ({
  duration: 0.11,
  sample: (t) => square(freq * (1 - t * 0.8), t) * 0.75 * Math.exp(-t * 22),
});

const definitions = {
  shoot: {
    duration: 0.2,
    sample: (t) => {
      const freq = 1000 * Math.exp(-t * 14) + 180;
      return (square(freq, t) * 0.35 + shootNoise(4000, t) * 0.15) * (1 - t / 0.2);
    },
  },
  alienHit: {
    duration: 0.3,
    sample: (t) => {
      const env = Math.exp(-t * 11);
      return (hitNoise(2600 - t * 5000, t) * 0.45 + square(520 - t * 1200, t) * 0.25) * env;
    },
  },
  playerDeath: {
    duration: 1.3,
    sample: (t) => {
      const env = Math.pow(1 - t / 1.3, 1.6);
      const wobble = 0.6 + 0.4 * Math.sin(2 * Math.PI * 9 * t);
      return deathNoise(1800 * (1 - t * 0.6) + 120, t) * 0.7 * env * wobble;
    },
  },
  march0: marchNote(110),
  march1: marchNote(98),
  march2: marchNote(87),
  march3: marchNote(82),
  ufo: {
    duration: 9,
    sample: (t) => {
      const sweep = (t * 6) % 1;
      const freq = 520 + 260 * (sweep < 0.5 ? sweep * 2 : 2 - sweep * 2);
      return Math.sin(2 * Math.PI * freq * t + Math.sin(2 * Math.PI * 3 * t)) * 0.3;
    },
  },
  ufoHit: {
    duration: 0.9,
    sample: (t) => {
      const freq = Math.floor(t / 0.035) % 2 === 0 ? 1560 : 1170;
      return square(freq, t) * 0.3 * (1 - t / 0.9);
    },
  },
  clash: {
    duration: 0.1,
    sample: (t) => clashNoise(5000, t) * 0.4 * (1 - t / 0.1),
  },
  extraLife: melody([[523, 0.07], [659, 0.07], [784, 0.07], [1047, 0.07], [784, 0.07], [1047, 0.2]], { duty: 0.25 }),
  coin: melody([[988, 0.08], [1319, 0.4]], { duty: 0.5, volume: 0.4 }),
  start: melody(
    [[392, 0.12], [0, 0.03], [392, 0.12], [523, 0.12], [659, 0.12], [784, 0.24], [659, 0.12], [784, 0.4]],
    { duty: 0.25, volume: 0.4 },
  ),
  waveClear: melody(
    [[262, 0.06], [330, 0.06], [392, 0.06], [523, 0.06], [659, 0.06], [784, 0.06], [1047, 0.3]],
    { duty: 0.25, volume: 0.4 },
  ),
  gameOver: melody(
    [[523, 0.16], [494, 0.16], [466, 0.16], [440, 0.16], [415, 0.2], [392, 0.24], [370, 0.3], [349, 0.7]],
    { duty: 0.5, volume: 0.4 },
  ),
  claudeDone: melody([[784, 0.09], [988, 0.09], [1175, 0.09], [1568, 0.35]], { duty: 0.25, volume: 0.45 }),
  claudeNeedsYou: melody([[880, 0.12], [0, 0.06], [880, 0.12], [0, 0.06], [880, 0.3]], { duty: 0.5, volume: 0.45 }),
  blip: melody([[1400, 0.035]], { duty: 0.5, volume: 0.3 }),
  highScore: melody(
    [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.2], [0, 0.05], [784, 0.1], [1047, 0.5]],
    { duty: 0.25, volume: 0.4 },
  ),
};

const toWav = ({ duration, sample }) => {
  const count = Math.floor(duration * RATE);
  const buffer = Buffer.alloc(44 + count);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + count, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count, 40);
  for (let i = 0; i < count; i++) {
    const value = Math.max(-1, Math.min(1, sample(i / RATE)));
    buffer[44 + i] = Math.round(128 + value * 100);
  }
  return buffer;
};

export const soundNames = Object.keys(definitions);

const writeSounds = () => {
  const dir = join(soundDir, `v${SYNTH_VERSION}`);
  mkdirSync(dir, { recursive: true });
  for (const [name, definition] of Object.entries(definitions)) {
    const file = join(dir, `${name}.wav`);
    if (!existsSync(file)) {
      writeFileSync(file, toWav(definition));
    }
  }
  return dir;
};

/** Sound output through the native helper's MCI channel; silent when there is no helper. */
export const createSound = (helper) => {
  let muted = false;
  let ready = false;
  if (helper) {
    try {
      const dir = writeSounds();
      for (const name of soundNames) {
        helper.send(`mci open "${join(dir, `${name}.wav`)}" type waveaudio alias ci_${name}`);
      }
      ready = true;
    } catch {
      ready = false;
    }
  }

  const play = (name) => {
    if (ready && !muted) {
      helper.send(`mci play ci_${name} from 0`);
    }
  };
  const stop = (name) => {
    if (ready) {
      helper.send(`mci stop ci_${name}`);
    }
  };

  return {
    play,
    stop,
    available: () => ready,
    isMuted: () => muted,
    toggleMute: () => {
      muted = !muted;
      if (muted) {
        stop('ufo');
      }
      return muted;
    },
  };
};
