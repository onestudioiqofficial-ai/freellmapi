/* ===== گۆڕینی خێرایی و بەرزی دەنگ — OLA و ڕیسەمپڵ ===== */

/* ڕیسەمپڵی هێڵی — rate: 2 = دەنگ دوو ئەوەندە خێراتر و کورتتر (بەرزی دەنگیش بەرز دەبێتەوە) */
export function resampleChannel(d, rate) {
  const newLen = Math.max(1, Math.round(d.length / rate));
  const out = new Float32Array(newLen);
  const step = rate;
  for (let i = 0; i < newLen; i++) {
    const pos = i * step;
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const a = d[Math.min(i0, d.length - 1)];
    const b = d[Math.min(i0 + 1, d.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/* درێژکردنەوەی کات بێ گۆڕینی بەرزی دەنگ (OLA — overlap-add) */
export function timeStretch(d, factor) {
  if (Math.abs(factor - 1) < 0.001) return d.slice();
  const grain = 2048;
  const synthHop = grain / 2;
  const analysisHop = Math.max(1, Math.round(synthHop / factor));
  const outLen = Math.max(grain, Math.round(d.length * factor));
  const out = new Float32Array(outLen);
  const w = new Float32Array(grain);
  for (let i = 0; i < grain; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / grain);
  let inPos = 0, outPos = 0;
  while (outPos + grain <= outLen && inPos + grain <= d.length) {
    for (let i = 0; i < grain; i++) out[outPos + i] += d[inPos + i] * w[i] * w[i];
    outPos += synthHop;
    inPos += analysisHop;
  }
  // نۆرمالکردن — kۆکردنەوەی w² بە هەمان ڕیزبەندی
  const wsum = new Float32Array(outLen);
  inPos = 0; outPos = 0;
  while (outPos + grain <= outLen && inPos + grain <= d.length) {
    for (let i = 0; i < grain; i++) wsum[outPos + i] += w[i] * w[i];
    outPos += synthHop;
    inPos += analysisHop;
  }
  for (let i = 0; i < outLen; i++) {
    const s = wsum[i];
    out[i] = s > 0.08 ? out[i] / s : 0;
  }
  return out;
}

/* گۆڕینی خێرایی لەگەڵ پاراستنی بەرزی دەنگ */
export function speedPreserve(d, rate) {
  if (Math.abs(rate - 1) < 0.001) return d.slice();
  return timeStretch(d, 1 / rate);
}

/* گۆڕینی بەرزی دەنگ — نیمەتۆن (+ درێژی دەگەڕێتەوە وەک خۆی) */
export function pitchShiftChannel(d, semitones) {
  if (Math.abs(semitones) < 0.01) return d.slice();
  const factor = Math.pow(2, semitones / 12);
  const stretched = timeStretch(d, factor); // درێژتر/کورتتر، بەرزی وەک خۆی
  return resampleChannel(stretched, factor); // بەرزی × factor، درێژی = بنەڕەت
}

/* جێبەجێکردن لەسەر هەموو کەناڵەکان — شوێنی گرەینەکان هاوبەشن بۆ پاراستنی ئیمەیجی ستێریۆ */
export function processChannels(channels, fn) {
  return channels.map(fn);
}
