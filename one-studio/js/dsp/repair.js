/* ===== چاککردن و شیکاریی دەنگ — پاککردنەوەی ژاوەژاو، کلیک، بێدەنگی، پێوانەی بەرزی ===== */
import { FFT, hann } from './fft.js';

const lin2db = (v) => 20 * Math.log10(Math.max(v, 1e-10));
const db2lin = (db) => Math.pow(10, db / 20);

/* ---------- فێربوونی پرۆفایلی ژاوەژاو لە بەشێک ---------- */
export function learnNoise(channels, sr, aSec, bSec, frame = 2048) {
  const win = hann(frame);
  const fft = new FFT(frame);
  const i0 = Math.max(0, Math.round(aSec * sr));
  const i1 = Math.min(channels[0].length, Math.round(bSec * sr));
  const bins = frame / 2 + 1;
  const acc = new Float32Array(bins);
  const re = new Float32Array(frame), im = new Float32Array(frame);
  let count = 0;
  const hop = frame / 2;
  for (let ch = 0; ch < channels.length; ch++) {
    const d = channels[ch];
    for (let p = i0; p + frame <= i1; p += hop) {
      for (let i = 0; i < frame; i++) { re[i] = d[p + i] * win[i]; im[i] = 0; }
      fft.forward(re, im);
      for (let k = 0; k < bins; k++) acc[k] += Math.hypot(re[k], im[k]);
      count++;
    }
  }
  if (!count) return null;
  const mag = new Float32Array(bins);
  for (let k = 0; k < bins; k++) mag[k] = acc[k] / count;
  return { mag, frame };
}

/* ---------- کەمکردنەوەی ژاوەژاو بە دەرهێنانی تایبەتمەندی ژاوەژاو (spectral subtraction) ---------- */
// strength: 0..1 , focus: 'broad' | 'hiss' , floorDb: بنکەی بەرگری
export function spectralDenoise(channels, sr, profile, opts, onProgress, isCancelled) {
  const { strength = 0.5, focus = 'broad', floorDb = -18, frame = 2048 } = opts;
  const win = hann(frame);
  const fft = new FFT(frame);
  const bins = frame / 2 + 1;
  const hop = frame / 4;
  const noise = profile.mag;
  // کێشی فرێکوێنسی بۆ جەختلەکردنە سەر هیس
  const w = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const f = k * sr / frame;
    w[k] = focus === 'hiss' ? (0.45 + 0.55 * Math.min(1, f / 5000)) : 1;
  }
  const floorLin = db2lin(floorDb);
  const out = channels.map(d => new Float32Array(d.length));
  const wsum = new Float32Array(channels[0].length + frame);
  const re = new Float32Array(frame), im = new Float32Array(frame);
  const gr = new Float32Array(bins).fill(1);
  const totalFrames = Math.max(1, Math.ceil((channels[0].length - frame) / hop));
  let done = 0, lastYield = 0;
  for (let p = 0; p + frame <= channels[0].length; p += hop) {
    if (isCancelled?.()) return null;
    for (let ch = 0; ch < channels.length; ch++) {
      const d = channels[ch], o = out[ch];
      for (let i = 0; i < frame; i++) { re[i] = d[p + i] * win[i]; im[i] = 0; }
      fft.forward(re, im);
      for (let k = 0; k < bins; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const target = noise[k] * w[k] * (1.35 + strength * 1.3); // پشتێنەی سەلامەتی
        let g = mag > 1e-9 ? Math.max((mag - target) / mag, floorLin) : 1;
        // نەرمکردن لەسەر فرێکوێنسی (٣ خاڵ)
        const gPrev = k > 0 ? gr[k - 1] : g, gNext = k < bins - 1 ? gr[k + 1] : g;
        const gs = (gPrev + 2 * g + gNext) / 4;
        gr[k] = Math.max(g, gs * 0.6 + g * 0.4);
        g = gr[k];
        const ph = Math.atan2(im[k], re[k]);
        const nm = mag * g;
        re[k] = nm * Math.cos(ph); im[k] = nm * Math.sin(ph);
        if (k > 0 && k < frame / 2) {
          re[frame - k] = re[k]; im[frame - k] = -im[k];
        }
      }
      fft.inverse(re, im);
      // OLA — پەنجەرەی هەردوو ڕوو + کۆکردنەوەی w² بۆ نۆرمالکردنی تەواو
      for (let i = 0; i < frame; i++) {
        const s = re[i] * win[i];
        o[p + i] += s;
        wsum[p + i] += win[i] * win[i];
      }
      if (ch === channels.length - 1) {
        done++;
        if (p - lastYield > 262144) {
          lastYield = p;
          onProgress?.(done / totalFrames);
        }
      }
    }
  }
  for (let ch = 0; ch < channels.length; ch++) {
    const o = out[ch];
    for (let i = 0; i < o.length; i++) {
      const wsi = wsum[i];
      o[i] = wsi > 1e-4 ? o[i] / wsi : o[i];
    }
  }
  return out;
}

/* ---------- چاککردنی کلیک و پەقین ---------- */
export function clickRepair(channels, sr, opts, onProgress, isCancelled) {
  const { sensitivity = 0.5, windowMs = 3 } = opts;
  const win = Math.max(16, Math.round(sr * windowMs / 1000 / 2) * 2);
  const thresh = 3.2 + (1 - sensitivity) * 6; // هەستیاری بەرز = هێڵی سنووری نزمتر
  const out = channels.map(d => d.slice());
  let clicks = 0;
  const total = channels.length;
  for (let ch = 0; ch < total; ch++) {
    const d = channels[ch], o = out[ch];
    for (let i = win; i < d.length - win; i++) {
      if ((i & 16383) === 0) {
        if (isCancelled?.()) return null;
        onProgress?.((ch + i / d.length) / total);
      }
      const x = d[i];
      if (Math.abs(x) < 1e-6) continue;
      // ناوەندی ناوخۆیی — نزیککردنەوە بە تێکڕای دوو لای
      const local = (Math.abs(d[i - win]) + Math.abs(d[i + win])) / 2 + 1e-6;
      const jump = Math.abs(x - (d[i - 1] + d[i + 1]) / 2);
      if (jump > local * thresh && jump > 0.0025) {
        // درێژی کلیک — لەگەڵ نەرمکردنی کەم
        let len = 1;
        while (len < 64 && i + len < d.length - win && Math.abs(d[i + len] - d[i + len - 1]) > local * thresh * 0.9) len++;
        const a = o[i - 1], b = o[Math.min(d.length - 1, i + len)];
        for (let k = 0; k < len; k++) {
          const t = (k + 1) / (len + 1);
          o[i + k] = a + (b - a) * t;
        }
        clicks++;
        i += len;
      }
    }
  }
  return { channels: out, clicks };
}

/* ---------- دۆزینەوەی بەشە بێدەنگەکان ---------- */
export function detectSilences(channels, sr, opts) {
  const { thresholdDb = -42, minDur = 0.6, pad = 0.08 } = opts;
  const d = channels[0];
  const winSize = Math.round(sr * 0.02);
  const thrLin = db2lin(thresholdDb);
  const silent = new Uint8Array(Math.ceil(d.length / winSize));
  for (let w = 0; w < silent.length; w++) {
    let peak = 0;
    const start = w * winSize, end = Math.min(d.length, start + winSize);
    for (let i = start; i < end; i += 2) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    silent[w] = peak < thrLin ? 1 : 0;
  }
  const regions = [];
  let s = -1;
  for (let w = 0; w <= silent.length; w++) {
    const isSil = w < silent.length ? silent[w] : 0;
    if (isSil && s < 0) s = w;
    if (!isSil && s >= 0) {
      const a = s * winSize / sr, b = w * winSize / sr;
      if (b - a >= minDur) regions.push({ a: Math.min(a + pad, b), b });
      s = -1;
    }
  }
  return regions;
}

/* ---------- بڕینی بەشە بێدەنگەکان ---------- */
export function removeSilences(channels, sr, regions, padSec = 0.08) {
  const keepRanges = [];
  let prev = 0;
  for (const r of regions) {
    const cutA = Math.max(0, Math.round((r.a) * sr));
    const cutB = Math.min(channels[0].length, Math.round((r.b - padSec) * sr));
    if (cutB > cutA) { keepRanges.push([prev, cutA]); prev = cutB; }
  }
  keepRanges.push([prev, channels[0].length]);
  let total = 0;
  for (const [a, b] of keepRanges) total += b - a;
  const out = channels.map(() => new Float32Array(total));
  let pos = 0;
  for (const [a, b] of keepRanges) {
    for (let ch = 0; ch < channels.length; ch++)
      out[ch].set(channels[ch].subarray(a, b), pos);
    pos += b - a;
  }
  return out;
}

/* ---------- پێوانەی بەرزی دەنگ (نزیککردنەوەی LUFS بە K-weighting) ---------- */
// دوو بیکواد: high-shelf +4dB لە ~1.5kHz و high-pass لە 38Hz (پێکهاتەی BS.1770)
function biquadProcess(data, b0, b1, b2, a1, a2) {
  const out = new Float32Array(data.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
  }
  return out;
}
function kWeightCoefs(sr) {
  // stage 1: high shelf — f0=1681Hz, G=+3.999dB, Q=0.7071
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
  const K = Math.tan(Math.PI * f0 / sr);
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const b0s = (Vh + Vb * K / Q + K * K) / a0;
  const b1s = 2 * (K * K - Vh) / a0;
  const b2s = (Vh - Vb * K / Q + K * K) / a0;
  const a1s = 2 * (K * K - 1) / a0;
  const a2s = (1 - K / Q + K * K) / a0;
  // stage 2: high pass — f0=38Hz, Q=0.5003
  const f0b = 38.13547087602444, Qb = 0.5003270373238773;
  const Kb = Math.tan(Math.PI * f0b / sr);
  const a0b = 1 + Kb / Qb + Kb * Kb;
  const c0 = 1, c1 = 2 * (Kb * Kb - 1) / a0b, c2 = (1 - Kb / Qb + Kb * Kb) / a0b;
  const d1 = 2 * (Kb * Kb - 1) / a0b, d2 = (1 - Kb / Qb + Kb * Kb) / a0b;
  return { b0s, b1s, b2s, a1s, a2s, c0, c1, c2, d1, d2 };
}
export function measureLoudness(channels, sr, onProgress, isCancelled) {
  const { b0s, b1s, b2s, a1s, a2s, c0, c1, c2, d1, d2 } = kWeightCoefs(sr);
  let peak = 0, sumSq = 0, nSamp = 0;
  const lufsBlocks = [];
  const blockSize = Math.round(sr * 0.4);
  const hopSize = Math.round(sr * 0.1);
  const weighted = [];
  for (let ch = 0; ch < channels.length; ch++) {
    if (isCancelled?.()) return null;
    onProgress?.(ch / (channels.length + 1));
    const s1 = biquadProcess(channels[ch], b0s, b1s, b2s, a1s, a2s);
    weighted.push(biquadProcess(s1, c0, c1, c2, d1, d2));
  }
  for (let ch = 0; ch < channels.length; ch++) {
    const d = channels[ch];
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]); if (a > peak) peak = a;
      sumSq += d[i] * d[i];
    }
    nSamp += d.length;
  }
  // بلۆکەکان
  const len = weighted[0].length;
  for (let start = 0; start + blockSize <= len; start += hopSize) {
    if ((start & 0xfffff) === 0 && isCancelled?.()) return null;
    let ms = 0;
    for (const w of weighted) {
      let sq = 0;
      for (let i = start; i < start + blockSize; i++) sq += w[i] * w[i];
      ms += sq / blockSize;
    }
    lufsBlocks.push(ms);
  }
  onProgress?.(0.9);
  const absBlocks = lufsBlocks.map(v => -0.691 + 10 * Math.log10(Math.max(v, 1e-12)));
  const above = absBlocks.filter(v => v > -70);
  let lufs = -Infinity;
  if (above.length) {
    const mean = above.reduce((a, b) => a + Math.pow(10, v10(b) / 10), 0) / above.length;
    const rel = -0.691 + 10 * Math.log10(mean) - 10;
    const gated = above.filter(v => v > rel);
    if (gated.length) {
      const mean2 = gated.reduce((a, b) => a + Math.pow(10, b / 10), 0) / gated.length;
      lufs = -0.691 + 10 * Math.log10(mean2);
    } else lufs = -0.691 + 10 * Math.log10(mean);
  }
  onProgress?.(1);
  return {
    peakDb: lin2db(peak),
    rmsDb: lin2db(Math.sqrt(sumSq / Math.max(1, nSamp))),
    lufs,
  };
}
const v10 = (x) => x; // یارمەتیدەر بۆ خوێندنەوە

/* ---------- ژمارەی گەین بۆ ئامانج ---------- */
export const gainForPeak = (channels, targetDb) => targetDb - lin2db(peakOf(channels));
export const peakOf = (channels) => {
  let peak = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  return peak;
};
