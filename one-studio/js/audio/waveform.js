/* ===== شێوەپەلی دەنگ — کانڤاسی پیشەیی لەگەڵ هەڵبژاردن، زووم و کێشانی کات ===== */
import { state, emit, setSelection, busOn } from '../state.js';
import { engine } from './engine.js';
import { runOp } from '../workers/client.js';
import { fmtTime } from '../utils.js';
import { t } from '../l10n.js';

const RULER_H = 22;

export class WaveformView {
  constructor() {
    this.main = null;       // canvas
    this.overview = null;   // canvas
    this.ctxM = null; this.ctxO = null;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.peaksCache = new Map();
    this.channels = null;   // کۆپیی کەناڵەکان بۆ وۆرکەر
    this.bufferKey = 0;
    this.pendingBucket = null;
    this.hoverX = null;
    this.dirty = true;
    this._pointers = new Map();
    this._drag = null;
    this._pinch = null;
    this._raf = 0;

    busOn('file', () => { this.invalidate(); });
    busOn('selection', () => { this.dirty = true; });
    busOn('markers', () => { this.dirty = true; });
  }

  attach(main, overview) {
    this.main = main; this.overview = overview;
    this.ctxM = main.getContext('2d');
    this.ctxO = overview.getContext('2d');
    this._bindMain();
    this._bindOverview();
    this._resize();
    this.invalidate();
  }

  invalidate() {
    this.peaksCache.clear();
    this.channels = null;
    this.bufferKey++;
    this.dirty = true;
    if (this.overview) this._requestPeaks('overview');
    this._resize();
  }

  _resize() {
    if (!this.main) return;
    const r = this.main.getBoundingClientRect();
    const h = r.height || 220;
    this.main.width = Math.max(50, Math.round(r.width * this.dpr));
    this.main.height = Math.round(h * this.dpr);
    const ro = this.overview.getBoundingClientRect();
    this.overview.width = Math.max(50, Math.round(ro.width * this.dpr));
    this.overview.height = Math.round(42 * this.dpr);
    this.dirty = true;
  }

  ensureChannels() {
    if (this.channels && this.channels.buf === state.working) return this.channels.data;
    if (!state.working) return null;
    const data = [];
    for (let c = 0; c < state.working.numberOfChannels; c++)
      data.push(state.working.getChannelData(c).slice());
    this.channels = { buf: state.working, data };
    return data;
  }

  /* ---- داواکردنی پیکەکان ---- */
  _requestPeaks(kind, bucketOverride = null) {
    if (!state.working) return;
    const data = this.ensureChannels();
    if (!data) return;
    let bucket;
    if (kind === 'overview') bucket = Math.max(16, Math.ceil(state.working.length / 1600));
    else {
      const width = this.main.width / this.dpr;
      const visSamples = (state.viewB - state.viewA) * state.working.sampleRate;
      bucket = Math.max(1, Math.round(visSamples / Math.max(1, width)));
      // نزیککردنەوە بۆ 2^k بۆ کاشی باشتر
      bucket = Math.pow(2, Math.round(Math.log2(Math.max(1, bucket))));
    }
    if (bucketOverride) bucket = bucketOverride;
    const key = `${this.bufferKey}:${bucket}`;
    if (this.peaksCache.has(key)) return this.peaksCache.get(key);
    if (this.pendingBucket === key) return null;
    this.pendingBucket = key;
    const myKey = this.bufferKey;
    runOp('peaks', {
      channels: data.map(d => d.slice()),
      sampleRate: state.working.sampleRate,
      bucket,
    }, {
      transfer: [],
    }).then(res => {
      this.pendingBucket = null;
      if (myKey !== this.bufferKey) return;
      const entry = { mins: res.mins, maxs: res.maxs, bucket };
      this.peaksCache.set(key, entry);
      this.dirty = true;
    }).catch(() => {
      this.pendingBucket = null;
      // فۆڵباک — هەژمارکردن لە تەردی سەرەکی
      const entry = this._computePeaksSync(data, bucket);
      if (entry && myKey === this.bufferKey) {
        this.peaksCache.set(key, entry);
        this.dirty = true;
      }
    });
    return null;
  }

  _computePeaksSync(data, bucket) {
    const total = Math.ceil(data[0].length / bucket);
    const mins = new Float32Array(total), maxs = new Float32Array(total);
    for (let b = 0; b < total; b++) {
      let mn = 1, mx = -1;
      const s = b * bucket, end = Math.min(data[0].length, s + bucket);
      for (let c = 0; c < data.length; c++) {
        const d = data[c];
        for (let i = s; i < end; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      }
      mins[b] = mn === 1 ? 0 : mn; maxs[b] = mx === -1 ? 0 : mx;
    }
    return { mins, maxs, bucket };
  }

  _getPeaks(bucket) {
    const key = `${this.bufferKey}:${bucket}`;
    let e = this.peaksCache.get(key);
    if (!e) {
      const data = this.ensureChannels();
      if (!data) return null;
      e = this._computePeaksSync(data, bucket);
      this.peaksCache.set(key, e);
      // پێش-هەڵگرتنی لە وۆرکەر بۆ جاری داهاتوو
      this._requestPeaks('main', bucket);
    }
    return e;
  }

  /* ---- وێنەکێشان ---- */
  draw() {
    if (!this.main || !state.working) return;
    const c = this.ctxM, W = this.main.width / this.dpr, H = this.main.height / this.dpr;
    c.save();
    c.scale(this.dpr, this.dpr);
    // پاشبنەما
    c.fillStyle = '#080b11';
    c.fillRect(0, 0, W, H);
    const sr = state.working.sampleRate;
    const dur = state.working.duration;
    const nCh = Math.min(2, state.working.numberOfChannels);
    const bodyH = H - RULER_H;
    const laneH = bodyH / nCh;

    // هێڵی ناوەڕاستی هەر لەینێک
    c.strokeStyle = 'rgba(255,255,255,.06)';
    c.lineWidth = 1;
    for (let l = 0; l < nCh; l++) {
      const cy = RULER_H + laneH * l + laneH / 2;
      c.beginPath(); c.moveTo(0, cy); c.lineTo(W, cy); c.stroke();
    }
    // تایم ڕوڵەر
    this._drawRuler(c, W, dur);

    const bucket = Math.max(1, Math.round(((state.viewB - state.viewA) * sr) / W));
    const pow2 = Math.pow(2, Math.round(Math.log2(bucket)));
    const peaks = this._getPeaks(pow2);

    if (peaks && peaks.bucket) {
      const scaleF = peaks.bucket / pow2;
      const grad = c.createLinearGradient(0, RULER_H, 0, H);
      grad.addColorStop(0, 'rgba(61,214,245,.95)');
      grad.addColorStop(0.5, 'rgba(79,141,255,.8)');
      grad.addColorStop(1, 'rgba(61,214,245,.95)');
      c.fillStyle = grad;
      for (let x = 0; x < W; x++) {
        const t0 = state.viewA + (x / W) * (state.viewB - state.viewA);
        const t1 = state.viewA + ((x + 1) / W) * (state.viewB - state.viewA);
        let i0 = Math.floor(t0 * sr / peaks.bucket);
        let i1 = Math.max(i0 + 1, Math.ceil(t1 * sr / peaks.bucket));
        i0 = Math.max(0, Math.min(peaks.mins.length - 1, i0));
        i1 = Math.max(i0 + 1, Math.min(peaks.mins.length, i1));
        for (let l = 0; l < nCh; l++) {
          // پیکەکان تێکەڵکراوی کەناڵەکانن بۆ نیشاندانی سادە
          let mn = 1, mx = -1;
          for (let i = i0; i < i1; i++) {
            if (peaks.mins[i] < mn) mn = peaks.mins[i];
            if (peaks.maxs[i] > mx) mx = peaks.maxs[i];
          }
          const cy = RULER_H + laneH * l + laneH / 2;
          const amp = (laneH / 2 - 3) * 0.94;
          const y0 = cy - mx * amp, y1 = cy - mn * amp;
          c.fillRect(x + 0.5, y0, Math.max(1, scaleF >= 1 ? 1 : 1), Math.max(1.2, y1 - y0));
        }
      }
    }

    // ناوچە کاتییەکانی پێشبینین (بێدەنگی و ...)
    if (state.tempRegions) {
      c.fillStyle = 'rgba(255,95,107,.22)';
      for (const r of state.tempRegions) {
        const x0 = ((r.a - state.viewA) / (state.viewB - state.viewA)) * W;
        const x1 = ((r.b - state.viewA) / (state.viewB - state.viewA)) * W;
        c.fillRect(x0, RULER_H, Math.max(1, x1 - x0), bodyH);
      }
    }
    // هەڵبژاردن
    if (state.selection) {
      const { a, b } = state.selection;
      const x0 = ((a - state.viewA) / (state.viewB - state.viewA)) * W;
      const x1 = ((b - state.viewA) / (state.viewB - state.viewA)) * W;
      c.fillStyle = 'rgba(240,180,41,.14)';
      c.fillRect(x0, RULER_H, x1 - x0, bodyH);
      c.strokeStyle = 'rgba(240,180,41,.85)';
      c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(x0, RULER_H); c.lineTo(x0, H); c.stroke();
      c.beginPath(); c.moveTo(x1, RULER_H); c.lineTo(x1, H); c.stroke();
      // دەستەکانی هەڵبژاردن
      c.fillStyle = '#f0b429';
      for (const x of [x0, x1]) {
        c.fillRect(x - 3.5, RULER_H, 7, 16);
      }
    }
    // نیشانەکانی بەشەکان
    c.font = '10px "Noto Sans Arabic"';
    for (const m of state.markers || []) {
      const x = ((m - state.viewA) / (state.viewB - state.viewA)) * W;
      if (x < -20 || x > W + 20) continue;
      c.strokeStyle = '#ffd166';
      c.lineWidth = 1;
      c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(x, RULER_H); c.lineTo(x, H); c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ffd166';
      c.fillRect(x, RULER_H, 16, 13);
      c.fillStyle = '#221600';
      c.fillText('S', x + 5, RULER_H + 10);
    }
    // نیشاندەری پەخش
    const ph = ((engine.position - state.viewA) / (state.viewB - state.viewA)) * W;
    if (ph >= 0 && ph <= W) {
      c.strokeStyle = '#ffffff';
      c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(ph, 4); c.lineTo(ph, H); c.stroke();
      c.fillStyle = '#f0b429';
      c.beginPath();
      c.moveTo(ph - 6, 4); c.lineTo(ph + 6, 4); c.lineTo(ph, 13);
      c.closePath(); c.fill();
    }
    // نیشاندانی کاتی هۆڤەر
    if (this.hoverX !== null && !this._drag) {
      c.strokeStyle = 'rgba(255,255,255,.25)';
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(this.hoverX, RULER_H); c.lineTo(this.hoverX, H); c.stroke();
      const ht = state.viewA + (this.hoverX / W) * (state.viewB - state.viewA);
      this._drawTimeTag(c, ht, this.hoverX, H);
    }
    c.restore();
    this.dirty = false;
  }

  _drawRuler(c, W, dur) {
    c.fillStyle = 'rgba(12,16,23,.9)';
    c.fillRect(0, 0, W, RULER_H);
    c.strokeStyle = 'rgba(255,255,255,.09)';
    c.beginPath(); c.moveTo(0, RULER_H - 0.5); c.lineTo(W, RULER_H - 0.5); c.stroke();
    const span = state.viewB - state.viewA;
    // هەنگاوی گونجاو
    const targets = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    let step = targets.find(s => span / s <= 10) || 900;
    c.font = '10px "Noto Kufi Arabic"';
    c.fillStyle = 'rgba(169,184,204,.8)';
    c.strokeStyle = 'rgba(255,255,255,.12)';
    for (let tt = Math.ceil(state.viewA / step) * step; tt <= state.viewB; tt += step) {
      const x = ((tt - state.viewA) / span) * W;
      c.beginPath(); c.moveTo(x, RULER_H - 5); c.lineTo(x, RULER_H); c.stroke();
      const label = fmtTime(tt, step < 1);
      const tw = c.measureText(label).width;
      c.fillText(label, Math.min(Math.max(2, x - tw / 2), W - tw - 2), 12);
    }
  }

  _drawTimeTag(c, time, x, H) {
    const label = fmtTime(time);
    c.font = '10.5px "Noto Kufi Arabic"';
    const w = c.measureText(label).width + 12;
    const tx = Math.min(Math.max(4, x - w / 2), this.main.width / this.dpr - w - 4);
    c.fillStyle = 'rgba(24,33,51,.95)';
    c.strokeStyle = 'rgba(240,180,41,.5)';
    c.beginPath();
    c.roundRect(tx, H - 24, w, 18, 6);
    c.fill(); c.stroke();
    c.fillStyle = '#ffd166';
    c.fillText(label, tx + 6, H - 11);
  }

  drawOverview() {
    if (!this.overview || !state.working) return;
    const c = this.ctxO, W = this.overview.width / this.dpr, H = this.overview.height / this.dpr;
    c.save(); c.scale(this.dpr, this.dpr);
    c.fillStyle = '#0a0e15';
    c.fillRect(0, 0, W, H);
    const bucket = Math.max(16, Math.ceil(state.working.length / (W * 2)));
    const pow2 = Math.pow(2, Math.ceil(Math.log2(bucket)));
    let peaks = this.peaksCache.get(`${this.bufferKey}:${pow2}`);
    if (!peaks) { this._requestPeaks('overview', pow2); c.restore(); this._drawViewRect(c, W, H); return; }
    const amp = H / 2 - 3;
    c.fillStyle = 'rgba(61,214,245,.55)';
    const total = peaks.mins.length;
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor(x / W * total), i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * total));
      let mn = 1, mx = -1;
      for (let i = i0; i < i1 && i < total; i++) { if (peaks.mins[i] < mn) mn = peaks.mins[i]; if (peaks.maxs[i] > mx) mx = peaks.maxs[i]; }
      if (mn === 1) { mn = 0; mx = 0; }
      c.fillRect(x, H / 2 - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
    this._drawViewRect(c, W, H);
    c.restore();
  }

  _drawViewRect(c, W, H) {
    const dur = state.working?.duration || 1;
    const x0 = (state.viewA / dur) * W, x1 = (state.viewB / dur) * W;
    c.fillStyle = 'rgba(4,6,10,.55)';
    c.fillRect(0, 0, x0, H);
    c.fillRect(x1, 0, W - x1, H);
    c.strokeStyle = '#f0b429';
    c.lineWidth = 1.2;
    c.strokeRect(x0 + 0.5, 0.5, Math.max(3, x1 - x0 - 1), H - 1);
  }

  tick() {
    if (!this.main) return;
    if (this.dirty || engine.isPlaying) { this.draw(); this.drawOverview(); }
    else if (this._lastPos !== engine.position) { this._lastPos = engine.position; this.draw(); }
  }

  /* ---- کارلێکەکان ---- */
  _timeAtX(x) {
    const W = this.main.width / this.dpr;
    return state.viewA + (x / W) * (state.viewB - state.viewA);
  }
  _xAt(e) {
    const r = this.main.getBoundingClientRect();
    return e.clientX - r.left;
  }

  _bindMain() {
    const cv = this.main;
    cv.addEventListener('pointerdown', (e) => {
      if (!state.working) return;
      cv.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, this._xAt(e));
      if (this._pointers.size === 2) {
        const xs = [...this._pointers.values()];
        this._pinch = { dist: Math.abs(xs[0] - xs[1]), viewA: state.viewA, viewB: state.viewB };
        this._drag = null;
        return;
      }
      const x = this._xAt(e);
      const time = this._timeAtX(x);
      // لێواری هەڵبژاردن؟
      if (state.selection) {
        const W = this.main.width / this.dpr;
        const px = (t0) => ((t0 - state.viewA) / (state.viewB - state.viewA)) * W;
        if (Math.abs(px(state.selection.a) - x) < 8) { this._drag = { mode: 'edge-a' }; return; }
        if (Math.abs(px(state.selection.b) - x) < 8) { this._drag = { mode: 'edge-b' }; return; }
      }
      this._drag = { mode: 'maybe', x0: x, t0: time, moved: false };
    });
    cv.addEventListener('pointermove', (e) => {
      if (!state.working) return;
      const x = this._xAt(e);
      this.hoverX = x;
      if (this._pointers.has(e.pointerId)) this._pointers.set(e.pointerId, x);
      // پینچ
      if (this._pinch && this._pointers.size === 2) {
        const xs = [...this._pointers.values()];
        const dist = Math.max(10, Math.abs(xs[0] - xs[1]));
        const scale = this._pinch.dist / dist;
        const centerT = (this._pinch.viewA + this._pinch.viewB) / 2;
        const span = Math.min(state.working.duration, Math.max(0.02, (this._pinch.viewB - this._pinch.viewA) * scale));
        state.viewA = Math.max(0, centerT - span / 2);
        state.viewB = Math.min(state.working.duration, centerT + span / 2);
        this.dirty = true;
        return;
      }
      if (!this._drag) { this.dirty = true; return; }
      const time = this._timeAtX(x);
      if (this._drag.mode === 'maybe') {
        if (Math.abs(x - this._drag.x0) > 4) this._drag.mode = 'select';
        else return;
      }
      if (this._drag.mode === 'select') {
        setSelection(this._drag.t0, time);
      } else if (this._drag.mode === 'edge-a') {
        setSelection(Math.min(time, state.selection.b), state.selection.b);
      } else if (this._drag.mode === 'edge-b') {
        setSelection(state.selection.a, Math.max(time, state.selection.a));
      }
    });
    const end = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      if (!this._drag) return;
      const d = this._drag;
      this._drag = null;
      if (d.mode === 'maybe') {
        engine.seek(d.t0);
        this.dirty = true;
      } else {
        emit('selection');
        this.dirty = true;
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { this.hoverX = null; this.dirty = true; });
    cv.addEventListener('dblclick', () => {
      if (!state.working) return;
      setSelection(0, state.working.duration);
    });
    cv.addEventListener('wheel', (e) => {
      if (!state.working) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.3 : 1 / 1.3;
      const anchor = this._timeAtX(this._xAt(e));
      this.zoom(factor, anchor);
    }, { passive: false });
  }

  zoom(factor, anchor = null) {
    if (!state.working) return;
    const dur = state.working.duration;
    if (anchor === null) anchor = (state.viewA + state.viewB) / 2;
    let span = (state.viewB - state.viewA) * factor;
    span = Math.min(dur, Math.max(0.01, span));
    let a = anchor - (anchor - state.viewA) * (span / (state.viewB - state.viewA));
    a = Math.max(0, Math.min(a, dur - span));
    state.viewA = a;
    state.viewB = a + span;
    this.dirty = true;
  }

  fitAll() {
    if (!state.working) return;
    state.viewA = 0;
    state.viewB = state.working.duration;
    this.dirty = true;
  }

  _bindOverview() {
    const cv = this.overview;
    let dragging = false;
    const jump = (e) => {
      const r = cv.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const dur = state.working?.duration || 1;
      const center = fx * dur;
      const span = state.viewB - state.viewA;
      state.viewA = Math.max(0, Math.min(center - span / 2, dur - span));
      state.viewB = state.viewA + span;
      this.dirty = true;
    };
    cv.addEventListener('pointerdown', (e) => { if (!state.working) return; try { cv.setPointerCapture(e.pointerId); } catch {} dragging = true; jump(e); });
    cv.addEventListener('pointermove', (e) => { if (dragging) jump(e); });
    cv.addEventListener('pointerup', () => { dragging = false; });
  }
}
