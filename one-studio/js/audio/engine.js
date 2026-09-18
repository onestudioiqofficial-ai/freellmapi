/* ===== بزوێنەری دەنگ — Web Audio API بە ڕاستی ===== */
import { buildGraph } from '../effects/chain.js';
import { state, emit } from '../state.js';
import { t } from '../l10n.js';
import { toast } from '../utils.js';

const WORKLET_URL = new URL('../workers/dsp-worklet.js', import.meta.url);

class Engine {
  ctx = null;
  res = { workletOk: false };
  decodeCtx = null;

  graph = null;
  previewChain = null; // پێشبینینی پێشڕێکخستن

  srcW = null; srcO = null;
  gProc = null; gOrig = null;
  sum = null; master = null;
  outA = [null, null];   // شیکەری دەرچوون L/R
  inA = [null, null];    // شیکەری چوونەژوورەوە
  specA = null;          // شیکەری فرێکوێنسی

  startedAt = 0;
  offset = 0;
  _playing = false;
  volume = 1;

  async ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error(t('errAudioContext'));
    this.ctx = new AC({ latencyHint: 'interactive' });
    try {
      await this.ctx.audioWorklet.addModule(WORKLET_URL);
      this.res.workletOk = true;
    } catch (e) {
      console.warn('وۆرکڵێت بەردەست نییە:', e);
      this.res.workletOk = false;
    }
    this._buildMeters();
    return this.ctx;
  }

  decodeCtxGet() {
    if (!this.decodeCtx) this.decodeCtx = new OfflineAudioContext(2, 1, 48000);
    return this.decodeCtx;
  }

  async decodeFile(arrayBuffer) {
    const ctx = this.decodeCtxGet();
    return await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer.slice(0), resolve, (e) => reject(e || new Error('decode')));
      if (p && p.then) p.then(resolve, reject);
    });
  }

  makeBuffer(channels, sampleRate) {
    const ctx = this.ctx || this.decodeCtxGet();
    const buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    for (let c = 0; c < channels.length; c++) buf.copyToChannel(channels[c], c);
    return buf;
  }

  channelData(buf) {
    const arrs = [];
    for (let c = 0; c < buf.numberOfChannels; c++) arrs.push(buf.getChannelData(c).slice());
    return arrs;
  }

  _buildMeters() {
    const ctx = this.ctx;
    this.sum = ctx.createGain();
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.gProc = ctx.createGain();
    this.gOrig = ctx.createGain();
    this.gProc.gain.value = 1; this.gOrig.gain.value = 0;
    this.sum.connect(this.master);
    for (let i = 0; i < 2; i++) {
      this.outA[i] = ctx.createAnalyser(); this.outA[i].fftSize = 1024;
      this.inA[i] = ctx.createAnalyser(); this.inA[i].fftSize = 1024;
    }
    this.specA = ctx.createAnalyser(); this.specA.fftSize = 4096; this.specA.smoothingTimeConstant = 0.82;
    const splitOut = ctx.createChannelSplitter(2);
    this.master.connect(splitOut);
    splitOut.connect(this.outA[0], 0);
    splitOut.connect(this.outA[1], 1);
    this.master.connect(this.specA);
    this.master.connect(this.ctx.destination);
  }

  _activeChain() { return this.previewChain || state.chain; }

  rebuildGraph() {
    if (!this.ctx) return;
    this.graph?.dispose();
    this.graph = null;
    const chain = this._activeChain();
    this.graph = buildGraph(this.ctx, chain, this.res);
    this.graph.output.connect(this.gProc);
    // تایپەری چوونەژوورەوە — لە سەرچاوەوە دوای ئەوەی سەرچاوە دروست دەکرێت
    for (const w of this.graph.wrappers) {
      if (w.impl?.fallback) w.impl.fallbackNoted = w.impl.fallbackNoted || (console.info('فۆڵباک بۆ', w.inst.type), true);
    }
  }

  async play(from = null) {
    if (!state.working) return;
    await this.ensure();
    const pos = from ?? this.position;
    this._stopSources();
    if (!this.graph) this.rebuildGraph();
    const buf = state.working;
    const loop = this._loopRange();

    this.srcW = this.ctx.createBufferSource();
    this.srcW.buffer = buf;
    this.srcO = this.ctx.createBufferSource();
    this.srcO.buffer = state.original;

    for (const s of [this.srcW, this.srcO]) {
      if (!s || !s.buffer) continue;
      if (state.loop && loop) { s.loop = true; s.loopStart = loop.a; s.loopEnd = loop.b; }
    }
    // گرافی زنجیرە — هەمیشە بە گرافەوە بەستراوە (زنجیرەی بەتاڵ = پەسەڕاستەوخۆ)
    this.srcW.connect(this.graph.input);
    if (this.srcO.buffer) this.srcO.connect(this.gOrig);
    // مێتەری چوونەژوورەوە
    const splitIn = this.ctx.createChannelSplitter(2);
    this.srcW.connect(splitIn);
    splitIn.connect(this.inA[0], 0);
    splitIn.connect(this.inA[1], 1);
    this._inSplit = splitIn;

    const startOffset = Math.min(pos, buf.duration - 0.005);
    const when = this.ctx.currentTime + 0.03;
    try {
      this.srcW.start(when, Math.max(0, startOffset));
      if (this.srcO.buffer) this.srcO.start(when, Math.max(0, Math.min(startOffset, this.srcO.buffer.duration - 0.005)));
    } catch (e) {
      console.error(e);
      toast(t('errPlay'), 'error');
      return;
    }
    this.startedAt = when;
    this.offset = Math.max(0, startOffset);
    this._playing = true;
    this._endedFired = false;
    this.srcW.onended = () => {
      if (!this._playing || this._stopping) return;
      if (state.loop && loop) return;
      this._playing = false;
      this.position = state.working.duration;
      state.playing = false;
      emit('transport');
    };
    state.playing = true;
    emit('transport');
  }

  _loopRange() {
    if (state.selection) return state.selection;
    if (state.working) return { a: 0, b: state.working.duration };
    return null;
  }

  _stopSources() {
    this._stopping = true;
    for (const s of [this.srcW, this.srcO]) {
      if (s) { try { s.onended = null; s.stop(); s.disconnect(); } catch {} }
    }
    if (this._inSplit) { try { this._inSplit.disconnect(); } catch {} this._inSplit = null; }
    this.srcW = this.srcO = null;
    this._stopping = false;
  }

  pause() {
    if (!this._playing) return;
    this.position = this.position; // کۆکردنەوەی شوێن
    this._stopSources();
    this._playing = false;
    state.playing = false;
    emit('transport');
  }

  stop() {
    this._stopSources();
    this._playing = false;
    this.offset = 0;
    this.position = 0;
    state.playing = false;
    emit('transport');
  }

  seek(t) {
    const d = state.working?.duration || 0;
    const nt = Math.max(0, Math.min(t, d));
    if (this._playing) this.play(nt);
    else { this.offset = nt; this.position = nt; emit('transport'); }
  }

  get position() {
    if (!this._playing) return this.offset;
    let pos = this.offset + (this.ctx.currentTime - this.startedAt);
    const loop = state.loop ? this._loopRange() : null;
    if (loop && pos > loop.a) {
      const len = Math.max(0.01, loop.b - loop.a);
      if (pos > loop.b) pos = loop.a + ((pos - loop.a) % len);
    }
    return Math.min(pos, state.working ? state.working.duration : pos);
  }

  set position(v) { this.offset = v; }

  get isPlaying() { return this._playing; }

  togglePlay() { this._playing ? this.pause() : this.play(); }

  setCompare(mode) {
    if (!this.ctx) return;
    this.gProc.gain.setTargetAtTime(mode === 'after' ? 1 : 0, this.ctx.currentTime, 0.012);
    this.gOrig.gain.setTargetAtTime(mode === 'after' ? 0 : 1, this.ctx.currentTime, 0.012);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /* --- گۆڕانکارییەکانی state --- */
  chainStructureChanged() {
    const wasPlaying = this._playing;
    const pos = this.position;
    if (wasPlaying) this._stopSources();
    this.rebuildGraph();
    if (wasPlaying) this.play(pos);
  }
  chainParamChanged(inst) {
    if (this.graph) this.graph.updateParams(inst);
  }
  bypassChanged(inst) {
    if (this.graph) this.graph.setBypass(inst.uid, !!inst.bypassed);
  }
  bufferReplaced() {
    this.stop();
    this.offset = 0; this.position = 0;
  }

  /* --- مێتەرەکان --- */
  _buf = [new Float32Array(1024), new Float32Array(1024)];
  readLevels(analyser, ch) {
    if (!analyser) return { peak: 0, rms: 0 };
    const b = this._buf[ch];
    analyser.getFloatTimeDomainData(b);
    let peak = 0, sum = 0;
    for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > peak) peak = a; sum += b[i] * b[i]; }
    return { peak, rms: Math.sqrt(sum / b.length) };
  }
  meters() {
    return {
      out: [this.readLevels(this.outA[0], 0), this.readLevels(this.outA[1], 1)],
      in: [this.readLevels(this.inA[0], 0), this.readLevels(this.inA[1], 1)],
      gr: this.graph ? this.graph.gainReduction() : 0,
      active: this._playing,
    };
  }
  spectrum(arr) {
    if (!this.specA) return false;
    this.specA.getFloatFrequencyData(arr);
    return true;
  }
  spectrumBins() { return this.specA ? this.specA.frequencyBinCount : 0; }
  sampleRate() { return this.ctx ? this.ctx.sampleRate : 48000; }
}

export const engine = new Engine();

/* ---- جێبەجێکردنی دەستکاریکردنی بەفەر لەسەر working ---- */
export function applyWorkingBuffer(newChannels, sampleRate, logText) {
  const oldBuf = state.working;
  const newBuf = engine.makeBuffer(newChannels, sampleRate);
  state.working = newBuf;
  state.selection = null;
  state.markers = (state.markers || []).filter(m => m <= newBuf.duration);
  state.tempRegions = null;
  import('../state.js').then(({ pushUndo, emit }) => {
    pushUndo({
      holdsAudio: true, log: logText,
      undo() { state.working = oldBuf; if (state.viewB > oldBuf.duration) { state.viewA = 0; state.viewB = oldBuf.duration; } emit('file'); },
      redo() { state.working = newBuf; emit('file'); },
    }, logText);
    emit('file');
  });
  engine.bufferReplaced();
  return newBuf;
}
