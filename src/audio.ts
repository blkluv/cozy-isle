// Tiny WebAudio synth — no assets, everything generated.
let ctx: AudioContext | null = null;

function ac(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, gain = 0.12, when = 0, slideTo?: number) {
  const c = ac();
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise(dur: number, gain = 0.1, freq = 1200, when = 0) {
  const c = ac();
  const t0 = c.currentTime + when;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t0);
}

export const sfx = {
  unlock() { ac(); },
  step() { noise(0.05, 0.02, 500); },
  pop() { tone(520, 0.09, 'sine', 0.14, 0, 880); },
  bell() { tone(1318, 0.28, 'triangle', 0.1); tone(1760, 0.34, 'triangle', 0.07, 0.05); },
  taskDone() {
    tone(660, 0.12, 'triangle', 0.12);
    tone(880, 0.14, 'triangle', 0.12, 0.09);
    tone(1320, 0.3, 'triangle', 0.1, 0.18);
  },
  rustle() { noise(0.32, 0.16, 2600); noise(0.22, 0.1, 1800, 0.08); },
  thud() { tone(140, 0.12, 'sine', 0.16, 0, 70); },
  splash() { noise(0.28, 0.18, 900); tone(300, 0.16, 'sine', 0.08, 0, 140); },
  bite() { tone(980, 0.07, 'square', 0.07); tone(980, 0.07, 'square', 0.07, 0.11); },
  reel() { tone(440, 0.2, 'sawtooth', 0.05, 0, 990); },
  talk() { tone(740 + Math.random() * 120, 0.06, 'sine', 0.08, 0, 990); },
  eat() { tone(300, 0.08, 'sine', 0.12, 0, 500); tone(500, 0.1, 'sine', 0.1, 0.09, 700); },
  fanfare() {
    const seq = [523, 659, 784, 1047];
    seq.forEach((f, i) => tone(f, 0.22, 'triangle', 0.12, i * 0.12));
    tone(1319, 0.5, 'triangle', 0.1, 0.52);
  },
};
