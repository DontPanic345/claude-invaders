import { emitKeypressEvents } from 'node:readline';

// Virtual-key codes polled by the native helper, in bit order.
const trackedKeys = [
  { vk: 37, names: ['left'], action: 'left' },
  { vk: 39, names: ['right'], action: 'right' },
  { vk: 65, names: ['a'], action: 'left' },
  { vk: 68, names: ['d'], action: 'right' },
  { vk: 32, names: ['space'], action: 'fire' },
];

const FALLBACK_HOLD_MS = 140;

/**
 * Merges stdin key presses with the helper's key-state polling. The terminal only reports
 * presses (and auto-repeats), so without the helper a key counts as held for a short window
 * after each press. With it, a key is held while it is physically down — but only once this
 * terminal has seen it pressed, so keys typed into other windows are ignored.
 */
export const createInput = (stdin) => {
  const events = [];
  const owned = trackedKeys.map(() => false);
  const lastPress = trackedKeys.map(() => 0);
  const tapPending = trackedKeys.map(() => false);
  let mask = 0;
  let helperWorks = false;

  const onKeyMask = (nextMask) => {
    mask = nextMask;
    const now = Date.now();
    trackedKeys.forEach((key, index) => {
      const down = (mask & (1 << index)) !== 0;
      if (down && now - lastPress[index] < 400) {
        helperWorks = true;
      }
      if (!down) {
        owned[index] = false;
      }
    });
  };

  emitKeypressEvents(stdin);
  stdin.on('keypress', (str, key = {}) => {
    if (key.ctrl && key.name === 'c') {
      events.push('quit');
      return;
    }
    const name = key.name ?? str;
    trackedKeys.forEach((tracked, index) => {
      if (tracked.names.includes(name)) {
        owned[index] = true;
        lastPress[index] = Date.now();
        tapPending[index] = true;
      }
    });
    if (name) {
      events.push(name.length === 1 ? name.toLowerCase() : name);
    }
  });

  const keyHeld = (index) => {
    if (helperWorks) {
      return owned[index] && (mask & (1 << index)) !== 0;
    }
    return Date.now() - lastPress[index] < FALLBACK_HOLD_MS;
  };

  return {
    helperKeyCodes: trackedKeys.map((key) => key.vk),
    onKeyMask,
    drainEvents: () => events.splice(0),
    /** Current action state; a press shorter than one poll still registers as a tap. */
    actions: () => {
      const state = { left: false, right: false, fire: false };
      trackedKeys.forEach((key, index) => {
        // Firing needs a fresh press (or the terminal's auto-repeat), like the arcade button.
        const held = key.action !== 'fire' && keyHeld(index);
        if (held || tapPending[index]) {
          state[key.action] = true;
        }
        tapPending[index] = false;
      });
      return state;
    },
  };
};
