/* ===== ئۆدیۆ وۆرکڵێتی وان ستۆدیۆ — دێ-ئێسەر و دەروازەی دەنگ =====
 * ئەم پڕۆسێسەرانە بە Sample-per-sample کار دەکەن — هیچ ساختەیەکیان تێدا نییە.
 */

const db2lin = (db) => Math.pow(10, db / 20);
const lin2db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
const coefMs = (ms) => Math.exp(-1 / (Math.max(0.05, ms) * 0.001 * sampleRate));

/* ---------- دەروازەی دەنگ (Gate / Expander) ---------- */
class OsGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -45, minValue: -80, maxValue: 0, automationRate: 'k-rate' },
      { name: 'attack', defaultValue: 5, minValue: 0.1, maxValue: 200, automationRate: 'k-rate' },   // ms
      { name: 'hold', defaultValue: 80, minValue: 0, maxValue: 800, automationRate: 'k-rate' },      // ms
      { name: 'release', defaultValue: 150, minValue: 5, maxValue: 1500, automationRate: 'k-rate' }, // ms
      { name: 'range', defaultValue: 60, minValue: 0, maxValue: 90, automationRate: 'k-rate' },      // dB بڕی کەمکردنەوە
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.gain = 1;
    this.holdCount = 0;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || !input.length || !input[0]) { output.forEach(o => o.fill(0)); return true; }
    const thr = params.threshold[0];
    const atkC = 1 - coefMs(params.attack[0]);
    const relC = 1 - coefMs(params.release[0]);
    const holdN = Math.round(params.hold[0] * 0.001 * sampleRate);
    const rangeLin = db2lin(-params.range[0]);
    const nCh = Math.min(input.length, output.length);
    const n = output[0].length;
    for (let i = 0; i < n; i++) {
      // پێوی ناوەندی هەموو کەناڵەکان
      let peak = 0;
      for (let c = 0; c < nCh; c++) { const a = Math.abs(input[c][i]); if (a > peak) peak = a; }
      // شوێنکەوتەری پێوی — کردنەوەی خێرا، داخستنی نەرم
      if (peak > this.env) this.env += (peak - this.env) * 0.35;
      else this.env *= 1 - relC * 0.25;
      const envDb = lin2db(this.env);
      let target;
      if (envDb >= thr) { target = 1; this.holdCount = holdN; }
      else if (this.holdCount > 0) { target = 1; this.holdCount--; }
      else target = rangeLin;
      // نەرمکردنی گەین — خێرا بۆ کردنەوە، هێواش بۆ داخران
      const coef = target > this.gain ? Math.max(atkC, 0.002) : Math.max(relC, 0.0006);
      this.gain += (target - this.gain) * coef;
      const g = this.gain;
      for (let c = 0; c < nCh; c++) output[c][i] = input[c][i] * g;
    }
    return true;
  }
}

/* ---------- دێ-ئێسەر — کەمکردنەوەی توندی س، ش، ز ---------- */
class OsDeEsser extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 6200, minValue: 1800, maxValue: 11000, automationRate: 'k-rate' },
      { name: 'threshold', defaultValue: -34, minValue: -70, maxValue: 0, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 60, minValue: 0, maxValue: 100, automationRate: 'k-rate' },  // ٪
      { name: 'range', defaultValue: 14, minValue: 1, maxValue: 30, automationRate: 'k-rate' },    // dB
    ];
  }
  constructor() {
    super();
    this.env = 0;
    this.grDb = 0;
    this.lastFreq = -1;
    this.b = [0, 0, 0]; this.a = [0, 0]; // فلتەری bandpass
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }
  setFreq(f) {
    const w0 = 2 * Math.PI * f / sampleRate;
    const alpha = Math.sin(w0) / (2 * 1.1); // Q=1.1
    const a0 = 1 + alpha;
    this.b[0] = alpha / a0; this.b[1] = 0; this.b[2] = -alpha / a0;
    this.a[0] = (-2 * Math.cos(w0)) / a0; this.a[1] = (1 - alpha) / a0;
    this.lastFreq = f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0];
    if (!input || !input.length || !input[0]) { output.forEach(o => o.fill(0)); return true; }
    const freq = params.freq[0], thr = params.threshold[0];
    const amount = params.amount[0] / 100, range = params.range[0];
    if (Math.abs(freq - this.lastFreq) > 0.5) this.setFreq(freq);
    const atkC = Math.max(1 - coefMs(1.5), 0.004);
    const relC = Math.max(1 - coefMs(70), 0.0004);
    const nCh = Math.min(input.length, output.length);
    const n = output[0].length;
    for (let i = 0; i < n; i++) {
      // تێکەڵەی مۆنۆ بۆ شیکاری
      let mono = 0;
      for (let c = 0; c < nCh; c++) mono += input[c][i];
      mono /= nCh;
      // فلتەری bandpass
      const x = mono;
      const y = this.b[0] * x + this.b[1] * this.x1 + this.b[2] * this.x2 - this.a[0] * this.y1 - this.a[1] * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
      // شوێنکەوتەری پێوی
      const ay = Math.abs(y);
      if (ay > this.env) this.env = ay;
      else this.env *= 0.9995;
      const excess = lin2db(this.env) - thr;
      let targetGr = 0;
      if (excess > 0) targetGr = -range * Math.min(1, excess / 14) * amount;
      // نەرمکردنی کەمکردنەوە
      const coef = targetGr < this.grDb ? atkC : relC;
      this.grDb += (targetGr - this.grDb) * coef;
      const g = db2lin(this.grDb);
      for (let c = 0; c < nCh; c++) output[c][i] = input[c][i] * g;
    }
    return true;
  }
}
registerProcessor('os-gate', OsGate);
registerProcessor('os-deesser', OsDeEsser);
