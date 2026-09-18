/* ===== مێتەر و شیکەری فرێکوێنسی ===== */
import { onFrame } from '../utils.js';
import { engine } from '../audio/engine.js';

const db2lin = (db) => Math.pow(10, db / 20);
const lin2db = (v) => 20 * Math.log10(Math.max(v, 1e-6));

/* ---- مێتەری VU بۆ هەر کەناڵێک ---- */
export class LevelMeter {
  // vertical: ئەگەر ڕاست بێت ستوونە
  constructor(canvas, { vertical = true, label = '' } = {}) {
    this.cv = canvas;
    this.c = canvas.getContext('2d');
    this.vertical = vertical;
    this.label = label;
    this.peakHold = 0;
    this.peakTime = 0;
    this.level = 0; // نەرمکراو
  }
  update(peak, rms) {
    this.level = Math.max(this.level * 0.82, Math.max(peak, rms));
    if (peak >= this.peakHold) { this.peakHold = peak; this.peakTime = performance.now(); }
    else if (performance.now() - this.peakTime > 1400) this.peakHold *= 0.94;
    this.draw();
  }
  draw() {
    const cv = this.cv;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = this.c;
    c.save();
    c.scale(dpr, dpr);
    c.clearRect(0, 0, W, H);
    // پاشبنەما
    c.fillStyle = '#080b11';
    c.fillRect(0, 0, W, H);
    const toFrac = (v) => {
      const db = lin2db(v);
      return Math.max(0, Math.min(1, (db + 54) / 54)); // -54dB .. 0dB
    };
    const lvl = toFrac(this.level);
    const grad = this.vertical
      ? c.createLinearGradient(0, H, 0, 0)
      : c.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#1f9e5f');
    grad.addColorStop(0.62, '#39d98a');
    grad.addColorStop(0.82, '#ffd166');
    grad.addColorStop(1, '#ff5f6b');
    const th = this.vertical ? Math.max(3, W * 0.5) : H * 0.62;
    if (this.vertical) {
      const x = (W - th) / 2;
      c.fillStyle = '#131b29';
      c.fillRect(x, 0, th, H);
      c.fillStyle = grad;
      c.fillRect(x, H * (1 - lvl), th, H * lvl);
      // هێڵی لووتکە
      const pk = toFrac(this.peakHold);
      c.fillStyle = this.peakHold > db2lin(0) ? '#ff5f6b' : '#eef4fb';
      c.fillRect(x, H * (1 - pk) - 1, th, 2);
    } else {
      c.fillStyle = '#131b29';
      c.fillRect(0, (H - th) / 2, W, th);
      c.fillStyle = grad;
      c.fillRect(0, (H - th) / 2, W * lvl, th);
      const pk = toFrac(this.peakHold);
      c.fillStyle = this.peakHold > db2lin(0) ? '#ff5f6b' : '#eef4fb';
      c.fillRect(W * pk - 1, (H - th) / 2, 2, th);
    }
    c.restore();
  }
}

/* ---- جوتی مێتەر — L/R ---- */
export class StereoMeter {
  constructor(container, { vertical = true } = {}) {
    this.vertical = vertical;
    container.classList.add('meter-vu');
    container.innerHTML = '';
    this.cvs = [document.createElement('canvas'), document.createElement('canvas')];
    for (const cv of this.cvs) {
      cv.style.width = vertical ? '9px' : '100%';
      cv.style.flex = vertical ? 'none' : '1';
      container.append(cv);
    }
    this.meters = this.cvs.map(cv => new LevelMeter(cv, { vertical }));
  }
  update(levels) {
    this.meters[0].update(levels[0].peak, levels[0].rms);
    this.meters[1].update(levels[1].peak, levels[1].rms);
  }
}

/* ---- مێتەری کەمکردنەوەی گەین ---- */
export class GRMeter {
  constructor(el_, { maxDb = 24 } = {}) {
    this.el = el_;
    this.maxDb = maxDb;
    this.el.innerHTML = '';
    this.fill = document.createElement('i');
    this.el.append(this.fill);
    this.label = document.createElement('span');
    this.label.className = 'num gr-val';
    this.el.append(this.label);
  }
  update(grDb) {
    const v = Math.min(this.maxDb, Math.abs(grDb));
    this.fill.style.width = (v / this.maxDb * 100) + '%';
    this.label.textContent = (Math.abs(grDb) < 0.1 ? '0' : '-' + v.toFixed(1)) + ' dB';
  }
}

/* ---- شیکەری فرێکوێنسی ---- */
export class SpectrumView {
  constructor(canvas) {
    this.cv = canvas;
    this.c = canvas.getContext('2d');
    this.arr = null;
    this.smooth = null;
    this.off = 0;
  }
  draw() {
    const cv = this.cv;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = this.c;
    c.save();
    c.scale(dpr, dpr);
    c.fillStyle = '#070a10';
    c.fillRect(0, 0, W, H);
    const sr = engine.sampleRate();
    const bins = engine.spectrumBins();
    if (!bins) { c.restore(); return; }
    if (!this.arr || this.arr.length !== bins) { this.arr = new Float32Array(bins); this.smooth = new Float32Array(bins).fill(-140); }
    if (!engine.spectrum(this.arr)) { c.restore(); this._grid(c, W, H, sr); return; }
    // تۆڕ
    this._grid(c, W, H, sr);
    // ستوونەکان بە سکەیڵی لۆگاریتمی
    const fMin = 30, fMax = Math.min(20000, sr / 2);
    const xOf = (f) => Math.log(f / fMin) / Math.log(fMax / fMin) * W;
    const bars = Math.min(180, Math.floor(W / 4));
    const grad = c.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(61,214,245,.85)');
    grad.addColorStop(0.7, 'rgba(79,141,255,.9)');
    grad.addColorStop(1, 'rgba(240,180,41,.95)');
    c.fillStyle = grad;
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const f0 = fMin * Math.pow(fMax / fMin, i / bars);
      const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / bars);
      const b0 = Math.floor(f0 / (sr / 2) * bins);
      const b1 = Math.max(b0 + 1, Math.floor(f1 / (sr / 2) * bins));
      let peak = -140;
      for (let b = b0; b < Math.min(b1, bins); b++) if (this.arr[b] > peak) peak = this.arr[b];
      const prev = this.smooth ? 0 : 0;
      const db = Math.max(-90, peak);
      const frac = Math.max(0, Math.min(1, (db + 90) / 90));
      const bh = frac * (H - 6);
      c.fillRect(i * bw + 0.5, H - bh, Math.max(1.5, bw - 1.5), bh);
    }
    c.restore();
  }
  _grid(c, W, H, sr) {
    const fMin = 30, fMax = Math.min(20000, sr / 2);
    c.font = '9px "Noto Sans Arabic"';
    c.strokeStyle = 'rgba(255,255,255,.06)';
    c.fillStyle = 'rgba(108,127,153,.7)';
    for (const f of [100, 1000, 10000]) {
      if (f > fMax) continue;
      const x = Math.log(f / fMin) / Math.log(fMax / fMin) * W;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
      c.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x + 3, 10);
    }
  }
}
