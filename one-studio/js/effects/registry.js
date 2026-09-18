/* ===== EffectRegistry — تۆماری ناوەندی هەموو ئامرازەکانی دەنگ =====
 * هەر ئامرازێک: پێناسەی پارامیتەر + جێبەجێکردنی ڕاستەقینەی Web Audio
 */

/* ---------- یارمەتیدەرەکان ---------- */
const bq = (ctx, type, freq, q = 1, gain = 0) => {
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = gain;
  return f;
};
const g = (ctx, v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
const pan = (ctx, v = 0) => {
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = v; return p; }
  return g(ctx, 1);
};
const lin = (x, a, b) => (x - a) / (b - a);
const lerp = (t, a, b) => a + (b - a) * t;

// وێڤشیپەر — کێشەی tanh و clip
function makeCurve(fn, n = 4096) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn((i / (n - 1)) * 2 - 1);
  return c;
}
const tanhCurve = () => makeCurve(x => Math.tanh(x));
const softClipCurve = (ceilLin) => makeCurve(x => {
  const y = Math.tanh(x * 1.6) / Math.tanh(1.6);
  return Math.max(-ceilLin, Math.min(ceilLin, y)) * 0.999 + y * 0.001;
});
const distCurves = {
  soft: makeCurve(x => Math.tanh(x * 2.2)),
  hard: makeCurve(x => Math.max(-0.82, Math.min(0.82, x * 3.4))),
  fold: makeCurve(x => Math.asin(Math.max(-1, Math.min(1, x * 1.6))) * 0.72),
};

// پشکنینی وۆرکڵێت
function workletNode(ctx, name, params, res) {
  if (!res.workletOk) return null;
  try {
    const n = new AudioWorkletNode(ctx, name, {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    });
    for (const [k, v] of Object.entries(params)) {
      if (n.parameters.get(k)) n.parameters.get(k).value = v;
    }
    return n;
  } catch { return null; }
}
function setWorkletParams(node, params) {
  if (!node) return;
  for (const [k, v] of Object.entries(params)) {
    const p = node.parameters.get(k);
    if (p) p.setTargetAtTime(v, 0, 0.02);
  }
}

/* ---------- ئیمپالسی ڕیڤێرب ---------- */
function makeIR(ctx, { seconds, decay, damping }) {
  const sr = ctx.sampleRate;
  const len = Math.max(512, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const damp = Math.exp(-2 * Math.PI * damping / sr);
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay * 1.8);
      const white = Math.random() * 2 - 1;
      lp = white * (1 - damp) + lp * damp;
      const v = lp * env * (i < sr * 0.004 ? i / (sr * 0.004) : 1); // نەرمکردنی سەرەتا
      d[i] = v;
      const a = Math.abs(v); if (a > peak) peak = a;
    }
  }
  if (peak > 0) {
    const s = 0.72 / peak;
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] *= s; }
  }
  return buf;
}

// مید/ساید — پانی ستێریۆ
function midSide(ctx, width01, balance01 = 0) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const split = ctx.createChannelSplitter(2);
  const mid = ctx.createGain(), side = ctx.createGain();
  const mL = g(ctx, 0.5), mR = g(ctx, 0.5);
  const sL = g(ctx, 0.5), sR = g(ctx, -0.5);
  const sScale = g(ctx, width01);
  const gML = g(ctx, 1 - balance01), gMR = g(ctx, 1 + balance01);
  const merge = ctx.createChannelMerger(2);
  input.connect(split);
  split.connect(mL, 0); split.connect(mR, 1);
  split.connect(sL, 0); split.connect(sR, 1);
  mL.connect(mid); mR.connect(mid);
  sL.connect(side); sR.connect(side);
  side.connect(sScale);
  // L = M·(1-b) + S·w , R = M·(1+b) + S·w
  mid.connect(gML); mid.connect(gMR);
  gML.connect(merge, 0, 0); sScale.connect(merge, 0, 0);
  gMR.connect(merge, 0, 1); sScale.connect(merge, 0, 1);
  merge.connect(output);
  return {
    input, output,
    set(w, b) {
      sScale.gain.setTargetAtTime(w, 0, 0.03);
      gML.gain.setTargetAtTime(1 - b, 0, 0.03);
      gMR.gain.setTargetAtTime(1 + b, 0, 0.03);
    },
  };
}

/* ---------- دروستکەرە هاوبەشەکان ---------- */
function wetDry(ctx, { wet = 30, dry = 100 }) {
  const input = g(ctx), output = g(ctx);
  const wetG = g(ctx, wet / 100), dryG = g(ctx, dry / 100);
  input.connect(dryG); dryG.connect(output);
  input.connect(wetG); wetG.connect(output);
  return { input, output, wetG, dryG, set(w, d) { wetG.gain.setTargetAtTime(w / 100, 0, 0.03); dryG.gain.setTargetAtTime(d / 100, 0, 0.03); } };
}

/* ================================================================
 * پێناسەی ئامرازەکان
 * ============================================================== */
const knob = (id, label, min, max, def, unit = 'uHz', opts = {}) => ({
  id, label, type: 'knob', min, max, def, unit, curve: 'lin', ...opts,
});
const select = (id, label, def, options, opts = {}) => ({ id, label, type: 'select', def, options, ...opts });
const toggle = (id, label, def, opts = {}) => ({ id, label, type: 'toggle', def, ...opts });

export const REGISTRY = {
  /* ---------- هاوسەنگکەرەوەی دەنگ ---------- */
  eq: {
    cat: 'catEq', icon: 'eq', label: 'tEq', desc: 'tEqDesc', kind: 'chain',
    special: 'eq',
    presets: [
      { id: 'eqPresetFlat', v: {} },
      { id: 'eqPresetClear', v: { hpOn: 1, hpFreq: 95, lsGain: -1.5, b1Gain: -2, b1Freq: 320, b2Freq: 900, b2Gain: 0.5, b3Freq: 3200, b3Gain: 2.5, b4Freq: 7200, b4Gain: 1.5, hsFreq: 9500, hsGain: 2 } },
      { id: 'eqPresetWarm', v: { hpOn: 1, hpFreq: 70, lsFreq: 160, lsGain: 2.5, b1Freq: 250, b1Gain: 1.5, b3Gain: -1, b4Gain: -1.5, hsGain: -1 } },
      { id: 'eqPresetWords', v: { hpOn: 1, hpFreq: 110, b1Freq: 400, b1Gain: -2.5, b2Freq: 1100, b2Gain: -1, b3Freq: 2800, b3Gain: 3.5, b4Freq: 5200, b4Gain: 2, hsGain: 1.5 } },
      { id: 'eqPresetCalm', v: { hpOn: 1, hpFreq: 85, lsGain: 1, b3Freq: 3000, b3Gain: -2, b4Gain: -1, hsGain: -1.5 } },
      { id: 'eqPresetFull', v: { hpOn: 1, hpFreq: 60, lsGain: 3, b1Gain: 1, b2Gain: 0.5, b3Gain: 1, hsGain: 1.5 } },
    ],
    params: [
      toggle('hpOn', 'p.hpOn', 1),
      knob('hpFreq', 'p.freq', 20, 500, 80, 'uHz', { curve: 'log', basic: true }),
      knob('lsFreq', 'p.freq', 40, 400, 150, 'uHz', { curve: 'log' }),
      knob('lsGain', 'p.gain', -15, 15, 0, 'uDb'),
      knob('b1Freq', 'p.freq', 80, 1200, 250, 'uHz', { curve: 'log' }),
      knob('b1Gain', 'p.gain', -15, 15, 0, 'uDb', { basic: true }),
      knob('b1Q', 'p.q', 0.3, 8, 1.1),
      knob('b2Freq', 'p.freq', 300, 3000, 800, 'uHz', { curve: 'log' }),
      knob('b2Gain', 'p.gain', -15, 15, 0, 'uDb', { basic: true }),
      knob('b2Q', 'p.q', 0.3, 8, 1.1),
      knob('b3Freq', 'p.freq', 1000, 8000, 2500, 'uHz', { curve: 'log' }),
      knob('b3Gain', 'p.gain', -15, 15, 0, 'uDb', { basic: true }),
      knob('b3Q', 'p.q', 0.3, 8, 1.1),
      knob('b4Freq', 'p.freq', 2500, 14000, 6000, 'uHz', { curve: 'log' }),
      knob('b4Gain', 'p.gain', -15, 15, 0, 'uDb', { basic: true }),
      knob('b4Q', 'p.q', 0.3, 8, 1.1),
      knob('hsFreq', 'p.freq', 2000, 16000, 9000, 'uHz', { curve: 'log' }),
      knob('hsGain', 'p.gain', -15, 15, 0, 'uDb'),
      toggle('lpOn', 'p.lpOn', 0),
      knob('lpFreq', 'p.freq', 1000, 20000, 16000, 'uHz', { curve: 'log' }),
    ],
    build(ctx, p) {
      const hp = bq(ctx, 'highpass', p.hpFreq, 0.72);
      const ls = bq(ctx, 'lowshelf', p.lsFreq, 1, p.lsGain);
      const b1 = bq(ctx, 'peaking', p.b1Freq, p.b1Q, p.b1Gain);
      const b2 = bq(ctx, 'peaking', p.b2Freq, p.b2Q, p.b2Gain);
      const b3 = bq(ctx, 'peaking', p.b3Freq, p.b3Q, p.b3Gain);
      const b4 = bq(ctx, 'peaking', p.b4Freq, p.b4Q, p.b4Gain);
      const hs = bq(ctx, 'highshelf', p.hsFreq, 1, p.hsGain);
      const lp = bq(ctx, 'lowpass', p.lpFreq, 0.72);
      const input = g(ctx), output = g(ctx);
      const chainN = [hp, ls, b1, b2, b3, b4, hs, lp];
      const toggleable = { hp, lp };
      function rewire() {
        input.disconnect(); hp.disconnect(); ls.disconnect(); b1.disconnect(); b2.disconnect();
        b3.disconnect(); b4.disconnect(); hs.disconnect(); lp.disconnect();
        const active = [];
        if (p.hpOn) active.push(hp);
        active.push(ls, b1, b2, b3, b4, hs);
        if (p.lpOn) active.push(lp);
        let prev = input;
        for (const f of active) { prev.connect(f); prev = f; }
        prev.connect(output);
        toggleable.hp.frequency.setTargetAtTime(p.hpOn ? p.hpFreq : 5, 0, 0.02);
        toggleable.lp.frequency.setTargetAtTime(p.lpOn ? p.lpFreq : 21000, 0, 0.02);
      }
      rewire();
      const nodes = [hp, ls, b1, b2, b3, b4, hs, lp];
      return {
        input, output, nodes,
        set(np) {
          Object.assign(p, {
            hpFreq: np.hpFreq, lsFreq: np.lsFreq, lsGain: np.lsGain,
            b1Freq: np.b1Freq, b1Gain: np.b1Gain, b1Q: np.b1Q,
            b2Freq: np.b2Freq, b2Gain: np.b2Gain, b2Q: np.b2Q,
            b3Freq: np.b3Freq, b3Gain: np.b3Gain, b3Q: np.b3Q,
            b4Freq: np.b4Freq, b4Gain: np.b4Gain, b4Q: np.b4Q,
            hsFreq: np.hsFreq, hsGain: np.hsGain,
            lpFreq: np.lpFreq, hpOn: np.hpOn, lpOn: np.lpOn,
          });
          hp.frequency.setTargetAtTime(p.hpFreq, 0, 0.02);
          ls.frequency.setTargetAtTime(p.lsFreq, 0, 0.02); ls.gain.setTargetAtTime(p.lsGain, 0, 0.02);
          b1.frequency.setTargetAtTime(p.b1Freq, 0, 0.02); b1.gain.setTargetAtTime(p.b1Gain, 0, 0.02); b1.Q.setTargetAtTime(p.b1Q, 0, 0.02);
          b2.frequency.setTargetAtTime(p.b2Freq, 0, 0.02); b2.gain.setTargetAtTime(p.b2Gain, 0, 0.02); b2.Q.setTargetAtTime(p.b2Q, 0, 0.02);
          b3.frequency.setTargetAtTime(p.b3Freq, 0, 0.02); b3.gain.setTargetAtTime(p.b3Gain, 0, 0.02); b3.Q.setTargetAtTime(p.b3Q, 0, 0.02);
          b4.frequency.setTargetAtTime(p.b4Freq, 0, 0.02); b4.gain.setTargetAtTime(p.b4Gain, 0, 0.02); b4.Q.setTargetAtTime(p.b4Q, 0, 0.02);
          hs.frequency.setTargetAtTime(p.hsFreq, 0, 0.02); hs.gain.setTargetAtTime(p.hsGain, 0, 0.02);
          lp.frequency.setTargetAtTime(p.lpFreq, 0, 0.02);
          rewire();
        },
        dispose() { try { input.disconnect(); output.disconnect(); chainN.forEach(n => n.disconnect()); } catch {} },
      };
    },
  },

  /* ---------- فلتەرەکان ---------- */
  lrFilter: {
    cat: 'catEq', icon: 'lrFilter', label: 'lrFilter', desc: 'lrFilterDesc', kind: 'chain',
    params: [
      knob('hpFreq', 'p.freq', 20, 1000, 80, 'uHz', { curve: 'log', basic: true }),
      knob('lpFreq', 'p.freq', 1000, 20000, 18000, 'uHz', { curve: 'log', basic: true }),
      knob('q', 'p.q', 0.3, 6, 0.75),
    ],
    build(ctx, p) {
      const hp = bq(ctx, 'highpass', p.hpFreq, p.q);
      const lp = bq(ctx, 'lowpass', p.lpFreq, p.q);
      hp.connect(lp);
      return {
        input: hp, output: lp,
        set(np) {
          hp.frequency.setTargetAtTime(np.hpFreq, 0, 0.02);
          lp.frequency.setTargetAtTime(np.lpFreq, 0, 0.02);
          hp.Q.setTargetAtTime(np.q, 0, 0.02); lp.Q.setTargetAtTime(np.q, 0, 0.02);
          Object.assign(p, { hpFreq: np.hpFreq, lpFreq: np.lpFreq, q: np.q });
        },
        dispose() { try { hp.disconnect(); lp.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- کۆمپرێسەر ---------- */
  compressor: {
    cat: 'catDynamics', icon: 'compressor', label: 'tComp', desc: 'tCompDesc', kind: 'chain',
    presets: [
      { id: 'compPresetQuran', v: { threshold: -24, ratio: 3, attack: 14, release: 200, knee: 12, makeup: 3 } },
      { id: 'compPresetSpeech', v: { threshold: -20, ratio: 2.5, attack: 10, release: 150, knee: 14, makeup: 2 } },
      { id: 'compPresetPodcast', v: { threshold: -26, ratio: 4, attack: 8, release: 180, knee: 10, makeup: 5 } },
      { id: 'compPresetGentle', v: { threshold: -16, ratio: 1.8, attack: 20, release: 250, knee: 20, makeup: 0 } },
    ],
    params: [
      knob('threshold', 'p.threshold', -60, 0, -22, 'uDb', { basic: true }),
      knob('ratio', 'p.ratio', 1, 20, 3, '', { basic: true, fmt: v => v.toFixed(1) + ':1' }),
      knob('attack', 'p.attack', 0, 200, 12, 'uMs'),
      knob('release', 'p.release', 10, 1000, 180, 'uMs'),
      knob('knee', 'p.knee', 0, 40, 12, 'uDb'),
      knob('makeup', 'p.makeup', 0, 24, 0, 'uDb', { basic: true }),
    ],
    build(ctx, p) {
      const comp = ctx.createDynamicsCompressor();
      const mk = g(ctx, Math.pow(10, p.makeup / 20));
      comp.threshold.value = p.threshold;
      comp.ratio.value = p.ratio;
      comp.attack.value = p.attack / 1000;
      comp.release.value = p.release / 1000;
      comp.knee.value = p.knee;
      comp.connect(mk);
      return {
        input: comp, output: mk,
        gr() { const r = comp.reduction; return typeof r === 'number' ? r : r?.value ?? 0; },
        set(np) {
          comp.threshold.setTargetAtTime(np.threshold, 0, 0.02);
          comp.ratio.setTargetAtTime(np.ratio, 0, 0.02);
          comp.attack.setTargetAtTime(np.attack / 1000, 0, 0.02);
          comp.release.setTargetAtTime(np.release / 1000, 0, 0.02);
          comp.knee.setTargetAtTime(np.knee, 0, 0.02);
          mk.gain.setTargetAtTime(Math.pow(10, np.makeup / 20), 0, 0.03);
          Object.assign(p, np);
        },
        dispose() { try { comp.disconnect(); mk.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- سنووردارکەرەوە ---------- */
  limiter: {
    cat: 'catDynamics', icon: 'limiter', label: 'tLimiter', desc: 'tLimiterDesc', kind: 'chain',
    params: [
      knob('inGain', 'p.inGain', -12, 12, 0, 'uDb'),
      knob('threshold', 'p.threshold', -24, 0, -2, 'uDb', { basic: true }),
      knob('ceiling', 'p.ceiling', -6, 0, -1, 'uDb', { basic: true }),
      knob('release', 'p.release', 20, 1000, 120, 'uMs'),
    ],
    build(ctx, p) {
      const inG = g(ctx, Math.pow(10, p.inGain / 20));
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = p.threshold; comp.ratio.value = 20;
      comp.attack.value = 0.002; comp.release.value = p.release / 1000; comp.knee.value = 0;
      // گەینی دوای — بۆ گەیشتن بە بنکەی سەرەوە
      const post = g(ctx, Math.pow(10, (p.ceiling - p.threshold) / 20));
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '2x';
      let ceilLin = Math.pow(10, p.ceiling / 20);
      shaper.curve = softClipCurve(ceilLin);
      inG.connect(comp); comp.connect(post); post.connect(shaper);
      return {
        input: inG, output: shaper,
        gr() { const r = comp.reduction; return typeof r === 'number' ? r : r?.value ?? 0; },
        set(np) {
          inG.gain.setTargetAtTime(Math.pow(10, np.inGain / 20), 0, 0.02);
          comp.threshold.setTargetAtTime(np.threshold, 0, 0.02);
          comp.release.setTargetAtTime(np.release / 1000, 0, 0.02);
          post.gain.setTargetAtTime(Math.pow(10, (np.ceiling - np.threshold) / 20), 0, 0.03);
          if (np.ceiling !== p.ceiling) {
            ceilLin = Math.pow(10, np.ceiling / 20);
            shaper.curve = softClipCurve(ceilLin);
          }
          Object.assign(p, np);
        },
        dispose() { try { inG.disconnect(); comp.disconnect(); post.disconnect(); shaper.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- دێ-ئێسەر ---------- */
  deesser: {
    cat: 'catDynamics', icon: 'deesser', label: 'tDeesser', desc: 'tDeesserDesc', kind: 'chain',
    presets: [
      { id: 'compPresetQuran', v: { freq: 6200, threshold: -34, amount: 60, range: 14 } },
      { id: 'intensitySoft', v: { freq: 6800, threshold: -30, amount: 35, range: 9 } },
      { id: 'intensityStrong', v: { freq: 5600, threshold: -40, amount: 85, range: 20 } },
    ],
    params: [
      knob('freq', 'p.freq', 2000, 10000, 6200, 'uHz', { curve: 'log', basic: true }),
      knob('threshold', 'p.threshold', -70, 0, -34, 'uDb', { basic: true }),
      knob('amount', 'p.amount', 0, 100, 60, 'uPct', { basic: true }),
      knob('range', 'p.range', 1, 30, 14, 'uDb'),
    ],
    build(ctx, p, res) {
      const node = workletNode(ctx, 'os-deesser', p, res);
      if (node) {
        return {
          input: node, output: node,
          set(np) { setWorkletParams(node, { freq: np.freq, threshold: np.threshold, amount: np.amount, range: np.range }); Object.assign(p, np); },
          dispose() { try { node.disconnect(); } catch {} },
        };
      }
      // فۆڵباک — داڕشتەیەکی سادەی EQ بێ وۆرکڵێت
      const input = g(ctx), output = g(ctx);
      const dip = bq(ctx, 'peaking', p.freq, 1.6, -(p.amount / 100) * p.range);
      input.connect(dip); dip.connect(output);
      return {
        input, output, fallback: true,
        set(np) {
          dip.frequency.setTargetAtTime(np.freq, 0, 0.03);
          dip.gain.setTargetAtTime(-(np.amount / 100) * np.range, 0, 0.03);
          Object.assign(p, np);
        },
        dispose() { try { input.disconnect(); dip.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- دەروازەی دەنگ ---------- */
  gate: {
    cat: 'catClean', icon: 'gate', label: 'tGate', desc: 'tGateDesc', kind: 'chain',
    params: [
      knob('threshold', 'p.threshold', -80, 0, -45, 'uDb', { basic: true }),
      knob('attack', 'p.attack', 0.1, 100, 5, 'uMs'),
      knob('hold', 'p.hold', 0, 500, 80, 'uMs'),
      knob('release', 'p.release', 5, 1500, 150, 'uMs'),
      knob('range', 'p.range', 0, 90, 60, 'uDb', { basic: true }),
    ],
    build(ctx, p, res) {
      const node = workletNode(ctx, 'os-gate', p, res);
      if (!node) {
        // فۆڵباک — بێ وۆرکڵێت ئەم ئامرازە کار ناکات، ڕاستگۆیی دەپارێزین
        const pas = g(ctx);
        return {
          input: pas, output: pas, fallback: true, inactive: true,
          set(np) { Object.assign(p, np); },
          dispose() { try { pas.disconnect(); } catch {} },
        };
      }
      return {
        input: node, output: node,
        set(np) { setWorkletParams(node, { threshold: np.threshold, attack: np.attack, hold: np.hold, release: np.release, range: np.range }); Object.assign(p, np); },
        dispose() { try { node.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- بۆشایی و ڕیڤێرب ---------- */
  reverb: {
    cat: 'catSpace', icon: 'reverb', label: 'tReverb', desc: 'tReverbDesc', kind: 'chain',
    presets: [
      { id: 'revPresetNone', v: { roomSize: 0.35, decay: 1.2, predelay: 5, damping: 8000, wet: 4, dry: 100, width: 40 } },
      { id: 'revPresetRoom', v: { roomSize: 0.6, decay: 1.6, predelay: 8, damping: 7000, wet: 9, dry: 100, width: 50 } },
      { id: 'revPresetHall', v: { roomSize: 1.8, decay: 2.4, predelay: 18, damping: 5500, wet: 14, dry: 100, width: 60 } },
      { id: 'revPresetBigHall', v: { roomSize: 3.4, decay: 3.2, predelay: 26, damping: 5000, wet: 18, dry: 100, width: 70 } },
      { id: 'revPresetWarm', v: { roomSize: 1.4, decay: 2.2, predelay: 14, damping: 2600, wet: 13, dry: 100, width: 55 } },
      { id: 'revPresetCalm', v: { roomSize: 1.2, decay: 2, predelay: 12, damping: 4500, wet: 8, dry: 100, width: 45 } },
      { id: 'revPresetPro', v: { roomSize: 1.6, decay: 2.3, predelay: 16, damping: 6000, wet: 11, dry: 100, width: 65 } },
      { id: 'revPresetCinema', v: { roomSize: 4.5, decay: 3.8, predelay: 34, damping: 3800, wet: 22, dry: 100, width: 85 } },
    ],
    params: [
      knob('roomSize', 'p.roomSize', 0.2, 8, 1.2, 'uSec', { curve: 'log', basic: true }),
      knob('decay', 'p.decay', 0.5, 6, 2.2, '', { fmt: v => v.toFixed(1) }),
      knob('predelay', 'p.predelay', 0, 120, 18, 'uMs', { basic: true }),
      knob('damping', 'p.damping', 500, 14000, 5500, 'uHz', { curve: 'log' }),
      knob('wet', 'p.wet', 0, 100, 8, 'uPct', { basic: true }),
      knob('dry', 'p.dry', 0, 100, 100, 'uPct'),
      knob('width', 'p.width', 0, 100, 55, 'uPct'),
    ],
    build(ctx, p) {
      const wd = wetDry(ctx, { wet: p.wet, dry: p.dry });
      const pre = ctx.createDelay(0.5);
      pre.delayTime.value = p.predelay / 1000;
      const conv = ctx.createConvolver();
      let irKey = '';
      const ms = midSide(ctx, p.width / 100);
      wd.input.connect(wd.dryG); // dry ڕاستەوخۆ
      wd.input.disconnect(wd.wetG);
      wd.input.connect(pre); pre.connect(conv); conv.connect(ms.input); ms.output.connect(wd.wetG);
      function ir() {
        const key = `${Math.round(p.roomSize * 20)}|${Math.round(p.decay * 10)}|${Math.round(p.damping)}`;
        if (key === irKey) return;
        irKey = key;
        conv.buffer = makeIR(ctx, { seconds: p.roomSize, decay: p.decay, damping: p.damping });
      }
      ir();
      return {
        input: wd.input, output: wd.output,
        set(np) {
          const old = { ...p };
          Object.assign(p, np);
          wd.set(np.wet, np.dry);
          ms.set(np.width / 100, 0);
          pre.delayTime.setTargetAtTime(np.predelay / 1000, 0, 0.03);
          if (old.roomSize !== np.roomSize || old.decay !== np.decay || old.damping !== np.damping) ir();
        },
        dispose() { try { wd.input.disconnect(); conv.disconnect(); ms.input.disconnect(); ms.output.disconnect(); wd.output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- دواخستنی دەنگ ---------- */
  delay: {
    cat: 'catSpace', icon: 'delay', label: 'tDelay', desc: 'tDelayDesc', kind: 'chain',
    presets: [
      { id: 'delPresetLight', v: { time: 140, feedback: 18, wet: 10, dry: 100, width: 50, lowcut: 300, highcut: 6000 } },
      { id: 'delPresetClear', v: { time: 220, feedback: 26, wet: 14, dry: 100, width: 60, lowcut: 380, highcut: 8000 } },
      { id: 'delPresetStereo', v: { time: 320, feedback: 34, wet: 18, dry: 100, width: 100, lowcut: 300, highcut: 7000 } },
      { id: 'delPresetLong', v: { time: 640, feedback: 48, wet: 22, dry: 100, width: 80, lowcut: 250, highcut: 5000 } },
    ],
    params: [
      knob('time', 'p.time', 10, 1500, 280, 'uMs', { curve: 'log', basic: true }),
      knob('feedback', 'p.feedback', 0, 90, 32, 'uPct', { basic: true }),
      knob('wet', 'p.wet', 0, 100, 18, 'uPct', { basic: true }),
      knob('dry', 'p.dry', 0, 100, 100, 'uPct'),
      knob('width', 'p.width', 0, 100, 70, 'uPct'),
      knob('lowcut', 'p.freq', 20, 2000, 320, 'uHz', { curve: 'log' }),
      knob('highcut', 'p.freq', 1000, 16000, 7500, 'uHz', { curve: 'log' }),
    ],
    build(ctx, p) {
      const wd = wetDry(ctx, { wet: p.wet, dry: p.dry });
      const cut1 = bq(ctx, 'highpass', p.lowcut, 0.7);
      const cut2 = bq(ctx, 'lowpass', p.highcut, 0.7);
      const dL = ctx.createDelay(2), dR = ctx.createDelay(2);
      dL.delayTime.value = p.time / 1000;
      dR.delayTime.value = (p.time / 1000) * 1.5; // پینگ-پۆنگ
      const fbL = g(ctx, p.feedback / 100), fbR = g(ctx, p.feedback / 100);
      const pL = pan(ctx, -0.7 * (p.width / 100)), pR = pan(ctx, 0.7 * (p.width / 100));
      wd.input.connect(wd.dryG);
      wd.input.disconnect(wd.wetG);
      wd.input.connect(cut1); cut1.connect(cut2);
      cut2.connect(dL);
      dL.connect(fbL); fbL.connect(dR);
      dR.connect(fbR); fbR.connect(dL);
      dL.connect(pL); dR.connect(pR);
      pL.connect(wd.wetG); pR.connect(wd.wetG);
      return {
        input: wd.input, output: wd.output,
        set(np) {
          Object.assign(p, np);
          wd.set(np.wet, np.dry);
          dL.delayTime.setTargetAtTime(np.time / 1000, 0, 0.08);
          dR.delayTime.setTargetAtTime((np.time / 1000) * 1.5, 0, 0.08);
          fbL.gain.setTargetAtTime(np.feedback / 100, 0, 0.05);
          fbR.gain.setTargetAtTime(np.feedback / 100, 0, 0.05);
          pL.pan?.setTargetAtTime(-0.7 * (np.width / 100), 0, 0.05);
          pR.pan?.setTargetAtTime(0.7 * (np.width / 100), 0, 0.05);
          cut1.frequency.setTargetAtTime(np.lowcut, 0, 0.05);
          cut2.frequency.setTargetAtTime(np.highcut, 0, 0.05);
        },
        dispose() { try { wd.input.disconnect(); dL.disconnect(); dR.disconnect(); fbL.disconnect(); fbR.disconnect(); cut1.disconnect(); cut2.disconnect(); pL.disconnect(); pR.disconnect(); wd.output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- دووبارەبوونەوەی دەنگ (ئێکۆ) ---------- */
  echo: {
    cat: 'catSpace', icon: 'echo', label: 'tEcho', desc: 'tEchoDesc', kind: 'chain',
    params: [
      knob('time', 'p.time', 50, 2000, 450, 'uMs', { curve: 'log', basic: true }),
      knob('feedback', 'p.feedback', 0, 85, 45, 'uPct', { basic: true }),
      knob('mix', 'p.mix', 0, 100, 25, 'uPct', { basic: true }),
      knob('decay', 'p.damping', 500, 12000, 3000, 'uHz', { curve: 'log' }),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const dryG = g(ctx, 1), wetG = g(ctx, p.mix / 100);
      const d = ctx.createDelay(3);
      d.delayTime.value = p.time / 1000;
      const fb = g(ctx, p.feedback / 100);
      const tone = bq(ctx, 'lowpass', p.decay, 0.7);
      input.connect(dryG); dryG.connect(output);
      input.connect(d); d.connect(tone); tone.connect(fb); fb.connect(d);
      tone.connect(wetG); wetG.connect(output);
      return {
        input, output,
        set(np) {
          Object.assign(p, np);
          d.delayTime.setTargetAtTime(np.time / 1000, 0, 0.08);
          fb.gain.setTargetAtTime(np.feedback / 100, 0, 0.05);
          wetG.gain.setTargetAtTime(np.mix / 100, 0, 0.03);
          tone.frequency.setTargetAtTime(np.decay, 0, 0.05);
        },
        dispose() { try { input.disconnect(); d.disconnect(); tone.disconnect(); fb.disconnect(); dryG.disconnect(); wetG.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- گەرمکردنی دەنگ ---------- */
  saturation: {
    cat: 'catSpace', icon: 'saturation', label: 'tSaturation', desc: 'tSaturationDesc', kind: 'chain',
    params: [
      knob('drive', 'p.drive', 1, 20, 2.2, 'uX', { curve: 'log', basic: true }),
      knob('mix', 'p.mix', 0, 100, 25, 'uPct', { basic: true }),
      knob('tone', 'p.tone', 800, 16000, 9000, 'uHz', { curve: 'log' }),
      knob('output', 'p.output', -12, 6, 0, 'uDb'),
    ],
    build(ctx, p) {
      p.drive = Math.min(20, Math.max(1, Number(p.drive) || 1));
      const input = g(ctx), output = g(ctx);
      const wetG = g(ctx, p.mix / 100), dryG = g(ctx, 1);
      const pre = g(ctx, p.drive);
      const post = g(ctx, 1 / Math.tanh(p.drive * 0.8));
      const tone = bq(ctx, 'lowpass', p.tone, 0.7);
      const outG = g(ctx, Math.pow(10, p.output / 20));
      const sh = ctx.createWaveShaper();
      sh.curve = tanhCurve(); sh.oversample = '2x';
      input.connect(dryG); dryG.connect(outG);
      input.connect(pre); pre.connect(sh); sh.connect(tone); tone.connect(post); post.connect(wetG); wetG.connect(outG);
      outG.connect(output);
      return {
        input, output,
        set(np) {
          Object.assign(p, np);
          np.drive = Math.min(20, Math.max(1, Number(np.drive) || 1));
          pre.gain.setTargetAtTime(np.drive, 0, 0.03);
          post.gain.setTargetAtTime(1 / Math.tanh(np.drive * 0.8), 0, 0.03);
          wetG.gain.setTargetAtTime(np.mix / 100, 0, 0.03);
          tone.frequency.setTargetAtTime(np.tone, 0, 0.03);
          outG.gain.setTargetAtTime(Math.pow(10, np.output / 20), 0, 0.03);
        },
        dispose() { try { input.disconnect(); sh.disconnect(); tone.disconnect(); dryG.disconnect(); wetG.disconnect(); outG.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- شێواندنی دەنگ ---------- */
  distortion: {
    cat: 'catSpace', icon: 'distortion', label: 'tDistortion', desc: 'tDistortionDesc', kind: 'chain',
    params: [
      knob('drive', 'p.drive', 1, 40, 6, 'uX', { curve: 'log', basic: true }),
      select('mode', 'p.style', 'soft', [
        { v: 'soft', k: 'intensitySoft' }, { v: 'hard', k: 'intensityMedium' }, { v: 'fold', k: 'intensityStrong' },
      ], { basic: true }),
      knob('tone', 'p.tone', 500, 14000, 4500, 'uHz', { curve: 'log' }),
      knob('mix', 'p.mix', 0, 100, 40, 'uPct'),
      knob('output', 'p.output', -12, 6, -2, 'uDb'),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const wetG = g(ctx, p.mix / 100), dryG = g(ctx, 1);
      const pre = g(ctx, p.drive);
      const tone = bq(ctx, 'lowpass', p.tone, 0.7);
      const outG = g(ctx, Math.pow(10, p.output / 20));
      const sh = ctx.createWaveShaper();
      sh.curve = distCurves[p.mode] || distCurves.soft; sh.oversample = '2x';
      const post = g(ctx, 1 / Math.max(0.2, p.drive * 0.35));
      input.connect(dryG); dryG.connect(outG);
      input.connect(pre); pre.connect(sh); sh.connect(tone); tone.connect(post); post.connect(wetG); wetG.connect(outG);
      outG.connect(output);
      return {
        input, output,
        set(np) {
          Object.assign(p, np);
          if (sh.curve !== distCurves[np.mode]) sh.curve = distCurves[np.mode] || distCurves.soft;
          pre.gain.setTargetAtTime(np.drive, 0, 0.03);
          post.gain.setTargetAtTime(1 / Math.max(0.2, np.drive * 0.35), 0, 0.03);
          wetG.gain.setTargetAtTime(np.mix / 100, 0, 0.03);
          tone.frequency.setTargetAtTime(np.tone, 0, 0.03);
          outG.gain.setTargetAtTime(Math.pow(10, np.output / 20), 0, 0.03);
        },
        dispose() { try { input.disconnect(); sh.disconnect(); tone.disconnect(); dryG.disconnect(); wetG.disconnect(); outG.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- کۆرەس ---------- */
  chorus: {
    cat: 'catSpace', icon: 'chorus', label: 'tChorus', desc: 'tChorusDesc', kind: 'chain',
    params: [
      knob('rate', 'p.rate', 0.1, 8, 0.9, 'uHz', { curve: 'log', basic: true }),
      knob('depth', 'p.depth', 0, 12, 3.2, 'uMs', { basic: true }),
      knob('mix', 'p.mix', 0, 100, 30, 'uPct', { basic: true }),
      knob('width', 'p.width', 0, 100, 80, 'uPct'),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const wetG = g(ctx, p.mix / 100), dryG = g(ctx, 1);
      const dL = ctx.createDelay(0.1), dR = ctx.createDelay(0.1);
      dL.delayTime.value = 0.022; dR.delayTime.value = 0.026;
      const lfo1 = ctx.createOscillator(), lfo2 = ctx.createOscillator();
      lfo1.frequency.value = p.rate; lfo2.frequency.value = p.rate;
      const dep1 = g(ctx, p.depth / 1000), dep2 = g(ctx, p.depth / 1000);
      lfo1.connect(dep1); dep1.connect(dL.delayTime);
      lfo2.connect(dep2); dep2.connect(dR.delayTime);
      lfo1.start(); lfo2.start(0, 0.35);
      const pL = pan(ctx, -0.8 * (p.width / 100)), pR = pan(ctx, 0.8 * (p.width / 100));
      input.connect(dryG); dryG.connect(output);
      input.connect(dL); input.connect(dR);
      dL.connect(pL); dR.connect(pR);
      pL.connect(wetG); pR.connect(wetG); wetG.connect(output);
      return {
        input, output,
        set(np) {
          Object.assign(p, np);
          lfo1.frequency.setTargetAtTime(np.rate, 0, 0.05);
          lfo2.frequency.setTargetAtTime(np.rate, 0, 0.05);
          dep1.gain.setTargetAtTime(np.depth / 1000, 0, 0.05);
          dep2.gain.setTargetAtTime(np.depth / 1000, 0, 0.05);
          wetG.gain.setTargetAtTime(np.mix / 100, 0, 0.03);
          pL.pan?.setTargetAtTime(-0.8 * (np.width / 100), 0, 0.05);
          pR.pan?.setTargetAtTime(0.8 * (np.width / 100), 0, 0.05);
        },
        dispose() { try { lfo1.stop(); lfo2.stop(); } catch {} try { input.disconnect(); dL.disconnect(); dR.disconnect(); wetG.disconnect(); dryG.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- فلەنجەر ---------- */
  flanger: {
    cat: 'catSpace', icon: 'flanger', label: 'tFlanger', desc: 'tFlangerDesc', kind: 'chain',
    params: [
      knob('rate', 'p.rate', 0.05, 5, 0.35, 'uHz', { curve: 'log', basic: true }),
      knob('depth', 'p.depth', 0, 8, 2.4, 'uMs', { basic: true }),
      knob('feedback', 'p.feedback', 0, 90, 35, 'uPct', { basic: true }),
      knob('mix', 'p.mix', 0, 100, 35, 'uPct'),
      knob('baseDelay', 'p.time', 0.2, 8, 2.5, 'uMs', { curve: 'log' }),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const wetG = g(ctx, p.mix / 100), dryG = g(ctx, 1);
      const d = ctx.createDelay(0.05);
      d.delayTime.value = p.baseDelay / 1000;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.rate;
      const dep = g(ctx, p.depth / 1000);
      lfo.connect(dep); dep.connect(d.delayTime);
      const fb = g(ctx, p.feedback / 100);
      lfo.start();
      input.connect(dryG); dryG.connect(output);
      input.connect(d); d.connect(fb); fb.connect(d);
      d.connect(wetG); wetG.connect(output);
      return {
        input, output,
        set(np) {
          Object.assign(p, np);
          lfo.frequency.setTargetAtTime(np.rate, 0, 0.05);
          dep.gain.setTargetAtTime(np.depth / 1000, 0, 0.05);
          d.delayTime.setTargetAtTime(np.baseDelay / 1000, 0, 0.05);
          fb.gain.setTargetAtTime(np.feedback / 100, 0, 0.05);
          wetG.gain.setTargetAtTime(np.mix / 100, 0, 0.03);
        },
        dispose() { try { lfo.stop(); } catch {} try { input.disconnect(); d.disconnect(); fb.disconnect(); wetG.disconnect(); dryG.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- فەیزەر ---------- */
  phaser: {
    cat: 'catSpace', icon: 'phaser', label: 'tPhaser', desc: 'tPhaserDesc', kind: 'chain',
    params: [
      knob('rate', 'p.rate', 0.05, 6, 0.5, 'uHz', { curve: 'log', basic: true }),
      knob('depth', 'p.depth', 0, 100, 55, 'uPct', { basic: true }),
      knob('feedback', 'p.feedback', 0, 80, 30, 'uPct'),
      knob('stages', 'p.stages', 2, 8, 6, '', { step: 1, fmt: v => String(Math.round(v)) }),
      knob('mix', 'p.mix', 0, 100, 45, 'uPct'),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const wetG = g(ctx, p.mix / 100), dryG = g(ctx, 1);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = p.rate;
      const depG = g(ctx, 1200 * (p.depth / 100));
      const center = g(ctx, 1400); // ناوەندی مۆدولەیشن
      lfo.connect(depG); depG.connect(center);
      const fb = g(ctx, p.feedback / 100);
      lfo.start();
      let stages = [], first = null, last = null;
      function buildStages(n) {
        stages.forEach(s => { try { s.disconnect(); } catch {} });
        stages = [];
        for (let i = 0; i < n; i++) {
          const ap = ctx.createBiquadFilter();
          ap.type = 'allpass'; ap.Q.value = 0.7;
          ap.frequency.value = 600 + i * 500;
          center.connect(ap.frequency);
          stages.push(ap);
        }
        input.disconnect(); if (first) try { first.disconnect(); } catch {}
        first = stages[0]; last = stages[stages.length - 1];
        input.connect(dryG); dryG.connect(output);
        input.connect(first);
        for (let i = 0; i < stages.length - 1; i++) stages[i].connect(stages[i + 1]);
        last.connect(fb); fb.connect(first);
        last.connect(wetG); wetG.connect(output);
      }
      buildStages(Math.round(p.stages));
      return {
        input, output,
        set(np) {
          const old = { ...p };
          Object.assign(p, np);
          lfo.frequency.setTargetAtTime(np.rate, 0, 0.05);
          depG.gain.setTargetAtTime(1200 * (np.depth / 100), 0, 0.05);
          fb.gain.setTargetAtTime(np.feedback / 100, 0, 0.05);
          wetG.gain.setTargetAtTime(np.mix / 100, 0, 0.03);
          if (Math.round(old.stages) !== Math.round(np.stages)) buildStages(Math.round(np.stages));
        },
        dispose() { try { lfo.stop(); } catch {} try { input.disconnect(); stages.forEach(s => s.disconnect()); wetG.disconnect(); dryG.disconnect(); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- پانیی ستێریۆ ---------- */
  stereoWidth: {
    cat: 'catEq', icon: 'width', label: 'tWidth', desc: 'tWidthDesc', kind: 'chain',
    note: 'widthWarning', noteType: 'warn',
    params: [
      knob('width', 'p.width', 0, 200, 100, 'uPct', { basic: true }),
      knob('balance', 'p.balance', -50, 50, 0, 'uPct'),
      toggle('monoCheck', 'p.monoCheck', 0, { basic: true }),
    ],
    build(ctx, p) {
      const ms = midSide(ctx, p.width / 100, p.balance / 100);
      const out = g(ctx, 1);
      let mono = null;
      function applyMono(on) {
        if (on && !mono) {
          const split = ctx.createChannelSplitter(2);
          const merge = ctx.createChannelMerger(2);
          const gl = g(ctx, 0.5), gr = g(ctx, 0.5);
          try { ms.output.disconnect(); } catch {}
          ms.output.connect(split);
          split.connect(gl, 0); split.connect(gr, 1);
          gl.connect(merge, 0, 0); gl.connect(merge, 0, 1);
          gr.connect(merge, 0, 0); gr.connect(merge, 0, 1);
          merge.connect(out);
          mono = { split, merge, gl, gr };
        } else if (!on && mono) {
          try { mono.split.disconnect(); mono.gl.disconnect(); mono.gr.disconnect(); mono.merge.disconnect(); } catch {}
          try { ms.output.disconnect(); } catch {}
          ms.output.connect(out);
          mono = null;
        }
      }
      applyMono(!!p.monoCheck);
      return {
        input: ms.input, output: out,
        set(np) {
          Object.assign(p, np);
          ms.set(np.width / 100, np.balance / 100);
          applyMono(!!np.monoCheck);
        },
        dispose() { try { ms.output.disconnect(); out.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- ڕێکخستنی چەپ و ڕاست ---------- */
  pan: {
    cat: 'catEq', icon: 'pan', label: 'tPan', desc: 'tPanDesc', kind: 'chain',
    params: [knob('pan', 'p.balance', -100, 100, 0, 'uPct', { basic: true })],
    build(ctx, p) {
      const pn = pan(ctx, p.pan / 100);
      return {
        input: pn, output: pn,
        set(np) { pn.pan?.setTargetAtTime(np.pan / 100, 0, 0.03); Object.assign(p, np); },
        dispose() { try { pn.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- ئاستی دەنگ ---------- */
  gain: {
    cat: 'catEq', icon: 'gain', label: 'tGain', desc: 'tGainDesc', kind: 'chain',
    params: [
      knob('inGain', 'p.inGain', -24, 24, 0, 'uDb', { basic: true }),
      knob('outGain', 'p.outGain', -24, 24, 0, 'uDb', { basic: true }),
    ],
    build(ctx, p) {
      const inG = g(ctx, Math.pow(10, p.inGain / 20));
      const outG = g(ctx, Math.pow(10, p.outGain / 20));
      const aIn = ctx.createAnalyser(); aIn.fftSize = 512;
      const aOut = ctx.createAnalyser(); aOut.fftSize = 512;
      const split1 = ctx.createChannelSplitter(2), split2 = ctx.createChannelSplitter(2);
      inG.connect(outG);
      inG.connect(split1);
      outG.connect(split2);
      const meters = { in: [null, null], out: [null, null] };
      if (ctx.createAnalyser) {
        meters.in[0] = ctx.createAnalyser(); meters.in[0].fftSize = 1024; split1.connect(meters.in[0], 0);
        meters.in[1] = ctx.createAnalyser(); meters.in[1].fftSize = 1024; split1.connect(meters.in[1], 1);
        meters.out[0] = ctx.createAnalyser(); meters.out[0].fftSize = 1024; split2.connect(meters.out[0], 0);
        meters.out[1] = ctx.createAnalyser(); meters.out[1].fftSize = 1024; split2.connect(meters.out[1], 1);
      }
      return {
        input: inG, output: outG, meters,
        set(np) {
          inG.gain.setTargetAtTime(Math.pow(10, np.inGain / 20), 0, 0.02);
          outG.gain.setTargetAtTime(Math.pow(10, np.outGain / 20), 0, 0.02);
          Object.assign(p, np);
        },
        dispose() { try { inG.disconnect(); outG.disconnect(); split1.disconnect(); split2.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- هاوسەنگکردنی خۆکار ---------- */
  autogain: {
    cat: 'catEq', icon: 'autogain', label: 'tAutoGain', desc: 'tAutoGainDesc', kind: 'chain',
    special: 'autogain',
    params: [
      knob('target', 'p.target', -30, -9, -16, 'uDb', { basic: true, fmt: v => v.toFixed(0) + ' LUFS' }),
      knob('makeup', 'p.makeup', -18, 18, 0, 'uDb', { basic: true }),
    ],
    build(ctx, p) {
      const gn = g(ctx, Math.pow(10, p.makeup / 20));
      return {
        input: gn, output: gn,
        set(np) {
          gn.gain.setTargetAtTime(Math.pow(10, np.makeup / 20), 0, 0.05);
          Object.assign(p, np);
        },
        dispose() { try { gn.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- پڕۆسەکردنی چەند باندی ---------- */
  multiband: {
    cat: 'catDynamics', icon: 'multiband', label: 'tMulti', desc: 'tMultiDesc', kind: 'chain',
    params: [
      knob('lowFreq', 'p.lowFreq', 60, 500, 180, 'uHz', { curve: 'log', basic: true }),
      knob('highFreq', 'p.highFreq', 1000, 8000, 3200, 'uHz', { curve: 'log', basic: true }),
      knob('lowThr', 'p.threshold', -50, 0, -24, 'uDb'),
      knob('lowRatio', 'p.ratio', 1, 12, 2.5),
      knob('lowGain', 'p.gain', -12, 12, 0, 'uDb', { basic: true }),
      knob('midThr', 'p.threshold', -50, 0, -20, 'uDb'),
      knob('midRatio', 'p.ratio', 1, 12, 3),
      knob('midGain', 'p.gain', -12, 12, 0, 'uDb', { basic: true }),
      knob('highThr', 'p.threshold', -50, 0, -26, 'uDb'),
      knob('highRatio', 'p.ratio', 1, 12, 2),
      knob('highGain', 'p.gain', -12, 12, 0, 'uDb', { basic: true }),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const sum = g(ctx);
      const mkBand = (filter) => {
        const comp = ctx.createDynamicsCompressor();
        const gn = g(ctx, 1);
        filter.connect(comp); comp.connect(gn); gn.connect(sum);
        return { filter, comp, gn };
      };
      const lp1 = bq(ctx, 'lowpass', p.lowFreq, 0.7);
      const hp1 = bq(ctx, 'highpass', p.lowFreq, 0.7);
      const lp2 = bq(ctx, 'lowpass', p.highFreq, 0.7);
      const hp2 = bq(ctx, 'highpass', p.highFreq, 0.7);
      input.connect(lp1);
      input.connect(hp1); hp1.connect(lp2);
      input.connect(hp2);
      const low = mkBand(lp1), mid = mkBand(lp2), high = mkBand(hp2);
      sum.connect(output);
      function apply() {
        low.comp.threshold.value = p.lowThr; low.comp.ratio.value = p.lowRatio; low.gn.gain.value = Math.pow(10, p.lowGain / 20);
        mid.comp.threshold.value = p.midThr; mid.comp.ratio.value = p.midRatio; mid.gn.gain.value = Math.pow(10, p.midGain / 20);
        high.comp.threshold.value = p.highThr; high.comp.ratio.value = p.highRatio; high.gn.gain.value = Math.pow(10, p.highGain / 20);
      }
      apply();
      return {
        input, output,
        gr() {
          const r = (c) => { const v = c.reduction; return typeof v === 'number' ? v : v?.value ?? 0; };
          return Math.min(r(low.comp), r(mid.comp), r(high.comp));
        },
        set(np) {
          Object.assign(p, np);
          lp1.frequency.setTargetAtTime(np.lowFreq, 0, 0.03);
          hp1.frequency.setTargetAtTime(np.lowFreq, 0, 0.03);
          lp2.frequency.setTargetAtTime(np.highFreq, 0, 0.03);
          hp2.frequency.setTargetAtTime(np.highFreq, 0, 0.03);
          apply();
        },
        dispose() { try { input.disconnect(); lp1.disconnect(); hp1.disconnect(); lp2.disconnect(); hp2.disconnect(); sum.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- لابردنی دەنگی کارەبا ---------- */
  humRemover: {
    cat: 'catClean', icon: 'hum', label: 'tHum', desc: 'tHumDesc', kind: 'chain',
    params: [
      select('base', 'p.base', 50, [
        { v: 50, k: 'q50', label: '50 Hz' }, { v: 60, k: 'q60', label: '60 Hz' },
      ], { basic: true }),
      knob('harmonics', 'p.harmonics', 1, 7, 4, '', { step: 1, fmt: v => String(Math.round(v)), basic: true }),
      knob('strength', 'p.strength', 0, 100, 60, 'uPct', { basic: true }),
    ],
    build(ctx, p) {
      const input = g(ctx), output = g(ctx);
      const notches = [];
      for (let i = 0; i < 7; i++) { const n = bq(ctx, 'notch', 50 * (i + 1), 25); notches.push(n); }
      function rewire() {
        input.disconnect(); notches.forEach(n => n.disconnect());
        const Q = 40 - (p.strength / 100) * 32; // توندی بەرز = ق ~ کەمتر
        const count = Math.round(p.harmonics);
        let prev = input;
        for (let i = 0; i < count; i++) {
          const n = notches[i];
          n.frequency.value = p.base * (i + 1);
          n.Q.value = Q;
          prev.connect(n); prev = n;
        }
        prev.connect(output);
      }
      rewire();
      return {
        input, output,
        set(np) { Object.assign(p, np); rewire(); },
        dispose() { try { input.disconnect(); notches.forEach(n => n.disconnect()); output.disconnect(); } catch {} },
      };
    },
  },

  /* ---------- باشترکردنی دەنگی قاری ---------- */
  voiceEnhancer: {
    cat: 'catQuick', icon: 'voice', label: 'tVoice', desc: 'tVoiceDesc', kind: 'chain',
    special: 'voice',
    presets: [
      { id: 'voicePresetClean', v: { style: 'clean' } },
      { id: 'voicePresetClear', v: { style: 'clear' } },
      { id: 'voicePresetWarm', v: { style: 'warm' } },
      { id: 'voicePresetCalm', v: { style: 'calm' } },
      { id: 'voicePresetFull', v: { style: 'full' } },
      { id: 'voicePresetColumn', v: { style: 'column' } },
    ],
    params: [
      select('style', 'p.style', 'clear', [
        { v: 'clean', k: 'voicePresetClean' }, { v: 'clear', k: 'voicePresetClear' },
        { v: 'warm', k: 'voicePresetWarm' }, { v: 'calm', k: 'voicePresetCalm' },
        { v: 'full', k: 'voicePresetFull' }, { v: 'column', k: 'voicePresetColumn' },
      ], { basic: true }),
      select('intensity', 'p.intensity', 'medium', [
        { v: 'soft', k: 'intensitySoft' }, { v: 'medium', k: 'intensityMedium' }, { v: 'strong', k: 'intensityStrong' },
      ], { basic: true }),
      knob('amount', 'p.amount', 0, 100, 70, 'uPct', { basic: true }),
    ],
    build(ctx, p, res) {
      const input = g(ctx), output = g(ctx);
      // زنجیرەی ناوەوە: HP → کەمکردنەوەی تۆپەخ → ئامادەکاری → کۆمپرێسەر → دێ-ئێسەر → تێربوونەوە → ئاسمان → لیمیتەر
      const hp = bq(ctx, 'highpass', 100, 0.72);
      const mud = bq(ctx, 'peaking', 350, 1.2, 0);
      const presence = bq(ctx, 'peaking', 3000, 0.9, 0);
      const air = bq(ctx, 'highshelf', 9500, 1, 0);
      const comp = ctx.createDynamicsCompressor();
      const deess = workletNode(ctx, 'os-deesser', { freq: 6200, threshold: -34, amount: 50, range: 12 }, res);
      const satIn = g(ctx, 1), satSh = ctx.createWaveShaper();
      satSh.curve = makeCurve(x => Math.tanh(x * 1.4)); satSh.oversample = '2x';
      const satMix = g(ctx, 0.1), satDry = g(ctx, 1), satWet = g(ctx, 0.06);
      const lim = ctx.createDynamicsCompressor();
      const outG = g(ctx, 1);
      // بەستن
      hp.connect(mud); mud.connect(presence); presence.connect(air); air.connect(comp);
      comp.connect(satIn);
      satIn.connect(satDry); satDry.connect(satMix);
      satIn.connect(satSh); satSh.connect(satWet); satWet.connect(satMix);
      if (deess) { satMix.connect(deess); deess.connect(lim); }
      else satMix.connect(lim);
      lim.connect(outG); outG.connect(output);
      const TABLES = {
        clean: { hp: 95, mudF: 300, mudG: -2.5, prF: 3200, prG: 1.5, air: 1, thr: -22, ratio: 2.4, atk: 0.012, rel: 0.22, mk: 2.5, dF: 6600, dT: -32, dA: 45, sat: 0.05, lThr: -3, lRel: 0.15 },
        clear: { hp: 105, mudF: 380, mudG: -3, prF: 3000, prG: 3, air: 1.5, thr: -22, ratio: 3, atk: 0.01, rel: 0.2, mk: 3, dF: 6200, dT: -34, dA: 60, sat: 0.06, lThr: -2.5, lRel: 0.12 },
        warm: { hp: 80, mudF: 220, mudG: 2, prF: 2600, prG: 1, air: 0.5, thr: -20, ratio: 2.6, atk: 0.015, rel: 0.25, mk: 2.5, dF: 7000, dT: -30, dA: 40, sat: 0.12, lThr: -3, lRel: 0.18 },
        calm: { hp: 90, mudF: 320, mudG: -1.5, prF: 3000, prG: -1.5, air: -1, thr: -18, ratio: 2, atk: 0.02, rel: 0.3, mk: 1.5, dF: 7200, dT: -28, dA: 30, sat: 0.03, lThr: -2, lRel: 0.2 },
        full: { hp: 85, mudF: 180, mudG: 2.5, prF: 2500, prG: 2, air: 1, thr: -24, ratio: 3.4, atk: 0.01, rel: 0.2, mk: 4, dF: 6400, dT: -34, dA: 55, sat: 0.1, lThr: -3.5, lRel: 0.12 },
        column: { hp: 115, mudF: 420, mudG: -4.5, prF: 3500, prG: 3.5, air: 2, thr: -26, ratio: 4.5, atk: 0.008, rel: 0.18, mk: 5.5, dF: 5800, dT: -38, dA: 75, sat: 0.07, lThr: -4.5, lRel: 0.1 },
      };
      const ISC = { soft: 0.7, medium: 1, strong: 1.4 };
      function apply() {
        const tb = TABLES[p.style] || TABLES.clear;
        const k = ISC[p.intensity] || 1;
        const amt = p.amount / 100;
        hp.frequency.setTargetAtTime(tb.hp, 0, 0.03);
        mud.frequency.setTargetAtTime(tb.mudF, 0, 0.03);
        mud.gain.setTargetAtTime(tb.mudG * amt, 0, 0.03);
        presence.frequency.setTargetAtTime(tb.prF, 0, 0.03);
        presence.gain.setTargetAtTime(tb.prG * k * amt, 0, 0.03);
        air.gain.setTargetAtTime(tb.air * k * amt, 0, 0.03);
        comp.threshold.setTargetAtTime(tb.thr - 6 * (k - 1) - 4 * amt, 0, 0.03);
        comp.ratio.setTargetAtTime(1 + (tb.ratio - 1) * k, 0, 0.03);
        comp.attack.value = tb.atk; comp.release.value = tb.rel;
        comp.knee.value = 10;
        satWet.gain.setTargetAtTime(tb.sat * amt, 0, 0.03);
        if (deess) setWorkletParams(deess, {
          freq: tb.dF, threshold: tb.dT - 9 * (k - 1), amount: Math.min(95, tb.dA * k * amt + 5), range: Math.min(26, 12 * k),
        });
        lim.threshold.setTargetAtTime(tb.lThr, 0, 0.03);
        lim.ratio.value = 12; lim.knee.value = 0; lim.attack.value = 0.002; lim.release.value = tb.lRel;
        outG.gain.setTargetAtTime(Math.pow(10, 2.2 * k * amt / 20), 0, 0.03);
      }
      apply();
      return {
        input, output,
        gr() { const r = lim.reduction; return typeof r === 'number' ? r : r?.value ?? 0; },
        set(np) { Object.assign(p, np); apply(); },
        dispose() { try { input.disconnect(); hp.disconnect(); mud.disconnect(); presence.disconnect(); air.disconnect(); comp.disconnect(); satSh.disconnect(); lim.disconnect(); outG.disconnect(); } catch {} },
      };
    },
  },

  /* ================ ئامرازە ئۆفلاینەکان ================ */
  noiseReduce: {
    cat: 'catClean', icon: 'noise', label: 'tNoise', desc: 'tNoiseDesc', kind: 'offline',
    params: [
      knob('strength', 'p.strength', 0, 100, 55, 'uPct', { basic: true }),
      knob('floor', 'p.floor', -30, -5, -16, 'uDb'),
      select('focus', 'p.style', 'broad', [
        { v: 'broad', k: 'tNoise' }, { v: 'hiss', k: 'tHiss' },
      ], { basic: true }),
    ],
  },
  silenceRemove: {
    cat: 'catClean', icon: 'silence', label: 'tSilenceRemove', desc: 'tSilenceRemoveDesc', kind: 'offline',
    params: [
      knob('thresholdDb', 'p.threshold', -60, -20, -42, 'uDb', { basic: true }),
      knob('minDur', 'p.minDur', 0.1, 3, 0.6, 'uSec', { basic: true, fmt: v => v.toFixed(2) }),
      knob('pad', 'p.padding', 0, 0.5, 0.08, 'uSec', { fmt: v => v.toFixed(2) }),
    ],
  },
  clickClean: {
    cat: 'catClean', icon: 'clicks', label: 'tClicks', desc: 'tClicksDesc', kind: 'offline',
    params: [
      knob('sensitivity', 'p.sensitivity', 0, 100, 55, 'uPct', { basic: true }),
      knob('windowMs', 'p.window', 1, 10, 3, 'uMs'),
    ],
  },
  pitch: {
    cat: 'catTime', icon: 'pitch', label: 'tPitch', desc: 'tPitchDesc', kind: 'offline',
    params: [
      knob('semitones', 'p.semitone', -12, 12, 0, '', { step: 1, fmt: v => (v > 0 ? '+' : '') + v.toFixed(0), basic: true }),
      knob('fine', 'p.fine', -100, 100, 0, '', { fmt: v => (v > 0 ? '+' : '') + v.toFixed(0) + ' cent' }),
    ],
  },
  speed: {
    cat: 'catTime', icon: 'speed', label: 'tSpeed', desc: 'tSpeedDesc', kind: 'offline',
    params: [
      select('rate', 'p.rate', 1, [
        { v: 0.5, label: '0.5×' }, { v: 0.75, label: '0.75×' }, { v: 1, label: '1×' },
        { v: 1.25, label: '1.25×' }, { v: 1.5, label: '1.5×' }, { v: 2, label: '2×' },
      ], { basic: true }),
      toggle('preserve', 'p.preserve', 1, { basic: true }),
    ],
  },
  vocalSep: {
    cat: 'catTime', icon: 'layers', label: 'tVocalSep', desc: 'tVocalSepDesc', kind: 'unavailable',
    params: [],
  },
};

/* ---- ناوی ئامرازەکان بۆ توڵەکان ---- */
export const TOOLS = [
  { id: 'quickEnhance', cat: 'catQuick', icon: 'wand', kind: 'wizard', label: 'tQuickEnhance', desc: 'tQuickEnhanceDesc' },
  { id: 'voiceEnhancer', cat: 'catQuick', icon: 'voice', kind: 'chain', ref: 'voiceEnhancer', label: 'tVoice', desc: 'tVoiceDesc' },
  { id: 'quickClean', cat: 'catQuick', icon: 'broom', kind: 'preset', preset: 'psQuickClean', label: 'tQuickClean', desc: 'tQuickCleanDesc' },

  { id: 'noiseReduce', cat: 'catClean', icon: 'noise', kind: 'offline', ref: 'noiseReduce', label: 'tNoise', desc: 'tNoiseDesc' },
  { id: 'hiss', cat: 'catClean', icon: 'hiss', kind: 'offline', ref: 'noiseReduce', presetValues: { focus: 'hiss', strength: 60 }, label: 'tHiss', desc: 'tHissDesc' },
  { id: 'clickClean', cat: 'catClean', icon: 'clicks', kind: 'offline', ref: 'clickClean', label: 'tClicks', desc: 'tClicksDesc' },
  { id: 'silenceRemove', cat: 'catClean', icon: 'silence', kind: 'offline', ref: 'silenceRemove', label: 'tSilenceRemove', desc: 'tSilenceRemoveDesc' },
  { id: 'humRemover', cat: 'catClean', icon: 'hum', kind: 'chain', ref: 'humRemover', label: 'tHum', desc: 'tHumDesc' },
  { id: 'gate', cat: 'catClean', icon: 'gate', kind: 'chain', ref: 'gate', label: 'tGate', desc: 'tGateDesc' },

  { id: 'eq', cat: 'catEq', icon: 'eq', kind: 'chain', ref: 'eq', label: 'tEq', desc: 'tEqDesc' },
  { id: 'lrFilter', cat: 'catEq', icon: 'lrFilter', kind: 'chain', ref: 'lrFilter', label: 'lrFilter', desc: 'lrFilterDesc' },
  { id: 'gain', cat: 'catEq', icon: 'gain', kind: 'chain', ref: 'gain', label: 'tGain', desc: 'tGainDesc' },
  { id: 'autogain', cat: 'catEq', icon: 'autogain', kind: 'chain', ref: 'autogain', label: 'tAutoGain', desc: 'tAutoGainDesc' },
  { id: 'loudness', cat: 'catEq', icon: 'loudness', kind: 'loudness', label: 'tLoudness', desc: 'tLoudnessDesc' },
  { id: 'normalize', cat: 'catEq', icon: 'gain', kind: 'normalize', label: 'tNormalize', desc: 'tNormalizeDesc' },
  { id: 'stereoWidth', cat: 'catEq', icon: 'width', kind: 'chain', ref: 'stereoWidth', label: 'tWidth', desc: 'tWidthDesc' },
  { id: 'pan', cat: 'catEq', icon: 'pan', kind: 'chain', ref: 'pan', label: 'tPan', desc: 'tPanDesc' },

  { id: 'compressor', cat: 'catDynamics', icon: 'compressor', kind: 'chain', ref: 'compressor', label: 'tComp', desc: 'tCompDesc' },
  { id: 'limiter', cat: 'catDynamics', icon: 'limiter', kind: 'chain', ref: 'limiter', label: 'tLimiter', desc: 'tLimiterDesc' },
  { id: 'deesser', cat: 'catDynamics', icon: 'deesser', kind: 'chain', ref: 'deesser', label: 'tDeesser', desc: 'tDeesserDesc' },
  { id: 'multiband', cat: 'catDynamics', icon: 'multiband', kind: 'chain', ref: 'multiband', label: 'tMulti', desc: 'tMultiDesc' },

  { id: 'reverb', cat: 'catSpace', icon: 'reverb', kind: 'chain', ref: 'reverb', label: 'tReverb', desc: 'tReverbDesc' },
  { id: 'delay', cat: 'catSpace', icon: 'delay', kind: 'chain', ref: 'delay', label: 'tDelay', desc: 'tDelayDesc' },
  { id: 'echo', cat: 'catSpace', icon: 'echo', kind: 'chain', ref: 'echo', label: 'tEcho', desc: 'tEchoDesc' },
  { id: 'chorus', cat: 'catSpace', icon: 'chorus', kind: 'chain', ref: 'chorus', label: 'tChorus', desc: 'tChorusDesc' },
  { id: 'flanger', cat: 'catSpace', icon: 'flanger', kind: 'chain', ref: 'flanger', label: 'tFlanger', desc: 'tFlangerDesc' },
  { id: 'phaser', cat: 'catSpace', icon: 'phaser', kind: 'chain', ref: 'phaser', label: 'tPhaser', desc: 'tPhaserDesc' },
  { id: 'saturation', cat: 'catSpace', icon: 'saturation', kind: 'chain', ref: 'saturation', label: 'tSaturation', desc: 'tSaturationDesc' },
  { id: 'distortion', cat: 'catSpace', icon: 'distortion', kind: 'chain', ref: 'distortion', label: 'tDistortion', desc: 'tDistortionDesc' },

  { id: 'pitch', cat: 'catTime', icon: 'pitch', kind: 'offline', ref: 'pitch', label: 'tPitch', desc: 'tPitchDesc' },
  { id: 'speed', cat: 'catTime', icon: 'speed', kind: 'offline', ref: 'speed', label: 'tSpeed', desc: 'tSpeedDesc' },
  { id: 'vocalSep', cat: 'catTime', icon: 'layers', kind: 'unavailable', label: 'tVocalSep', desc: 'tVocalSepDesc' },
];

export const CATS = ['catQuick', 'catClean', 'catEq', 'catDynamics', 'catSpace', 'catTime'];

export function defaultParams(type) {
  const def = REGISTRY[type];
  const p = {};
  for (const pd of def.params) p[pd.id] = pd.def;
  return p;
}
export function getParamDef(type, id) {
  return REGISTRY[type]?.params.find(p => p.id === id);
}
