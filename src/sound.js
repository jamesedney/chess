// Move sounds and haptics. Sounds are synthesised with Web Audio, so there are
// no audio files to download or cache.

const prefs = { sound: true, haptics: true };
let ctx = null;

export function configure({ sound, haptics }) {
  if (typeof sound === 'boolean') prefs.sound = sound;
  if (typeof haptics === 'boolean') prefs.haptics = haptics;
}

function audio() {
  if (ctx) return ctx;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** A short decaying tone. */
function tone(ac, { freq, start = 0, dur = 0.08, gain = 0.18, type = 'sine', slide = 0 }) {
  const t = ac.currentTime + start;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** A short filtered noise burst: the wooden "knock" of a piece landing. */
function knock(ac, { start = 0, dur = 0.05, gain = 0.35, freq = 900 }) {
  const t = ac.currentTime + start;
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 1.2;
  const g = ac.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
}

const SOUNDS = {
  move(ac) {
    knock(ac, { freq: 700 });
    tone(ac, { freq: 160, dur: 0.06, gain: 0.12, slide: 0.7 });
  },
  capture(ac) {
    knock(ac, { freq: 1300, gain: 0.45 });
    knock(ac, { freq: 600, start: 0.035, gain: 0.3 });
  },
  check(ac) {
    knock(ac, { freq: 800 });
    tone(ac, { freq: 660, start: 0.02, dur: 0.12, gain: 0.08, type: 'triangle' });
    tone(ac, { freq: 880, start: 0.09, dur: 0.14, gain: 0.07, type: 'triangle' });
  },
  success(ac) {
    [523, 659, 784].forEach((f, i) => tone(ac, { freq: f, start: i * 0.07, dur: 0.22, gain: 0.07, type: 'triangle' }));
  },
  error(ac) {
    tone(ac, { freq: 196, dur: 0.12, gain: 0.1, type: 'square', slide: 0.85 });
  },
};

const VIBRATIONS = { move: 8, capture: 14, check: [10, 40, 10], success: [12, 60, 24], error: [40, 50, 40] };

/** Play the cue for an event: move, capture, check, success or error. */
export function cue(kind) {
  // Browsers block vibration (and log an error) before the user has interacted with the page.
  const active = typeof navigator === 'undefined' || !navigator.userActivation || navigator.userActivation.hasBeenActive;
  if (prefs.haptics && active && VIBRATIONS[kind] !== undefined) {
    try {
      navigator.vibrate?.(VIBRATIONS[kind]);
    } catch {}
  }
  if (!prefs.sound || !SOUNDS[kind]) return;
  const ac = audio();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume().catch(() => {});
  try {
    SOUNDS[kind](ac);
  } catch {}
}
