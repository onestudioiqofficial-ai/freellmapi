/* ===== نموونەی تاقیکردنەوە — دەنگێکی دروستکراو بۆ تاقیکردنەوەی ئامرازەکان =====
 * دەنگێکی هاوشێوەی قیرائەت لەگەڵ ژاوەژاو، هیس و کلیک — بۆ ئەوەی ئامرازەکانی پاککردنەوە بە ڕاستی کاریگەر بن.
 */
export function createDemoBuffer(ctx) {
  const sr = ctx.sampleRate;
  const dur = 11;
  const len = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0);
  const R = buf.getChannelData(1);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };

  // دەنگی هاوشێوەی قیرائەت — فۆرمانتەکان لەگەڵ contour ی تۆن
  const phrases = [
    { a: 0.4, b: 2.6, f0: 128, vowel: 0 },
    { a: 3.1, b: 5.2, f0: 118, vowel: 1 },
    { a: 5.8, b: 7.6, f0: 132, vowel: 2 },
    { a: 8.3, b: 10.4, f0: 112, vowel: 1 },
  ];
  const FORMANTS = [
    { f1: 620, f2: 1180 },  // «a»
    { f1: 380, f2: 2100 },  // «i»
    { f1: 480, f2: 850 },   // «o»
  ];
  let lpL = 0, lpR = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / sr;
    // ژاوەژاوی ژینگە + هیس
    const hum = Math.sin(2 * Math.PI * 50 * tt) * 0.006 + Math.sin(2 * Math.PI * 100 * tt) * 0.003;
    const noise = rnd() * 0.012;
    lpL = noise * 0.25 + lpL * 0.75;
    lpR = noise * 0.25 + lpR * 0.75;
    let sl = hum + lpL + rnd() * 0.004; // هیس
    let srl = hum + lpR + rnd() * 0.004;
    // دەنگ
    for (const ph of phrases) {
      if (tt >= ph.a && tt <= ph.b) {
        const lt = tt - ph.a;
        const env = Math.min(1, lt / 0.12) * Math.min(1, (ph.b - tt) / 0.18) * (0.72 + 0.28 * Math.sin(2 * Math.PI * 4.6 * lt));
        const f0 = ph.f0 * (1 + 0.045 * Math.sin(2 * Math.PI * 0.9 * lt) - 0.12 * (lt / (ph.b - ph.a)));
        const fo = FORMANTS[ph.vowel];
        let vl = 0, vr = 0;
        for (let h = 1; h <= 14; h++) {
          const fh = f0 * h;
          if (fh > sr / 2 - 200) break;
          const g1 = 1 / (1 + Math.pow((fh - fo.f1) / 110, 2));
          const g2 = 1 / (1 + Math.pow((fh - fo.f2) / 160, 2));
          const amp = (g1 * 1 + g2 * 0.62) / h;
          const phs = 2 * Math.PI * fh * lt;
          vl += amp * Math.sin(phs + h * 0.4);
          vr += amp * Math.sin(phs + h * 0.4 + 0.06);
        }
        sl += vl * env * 0.16;
        srl += vr * env * 0.16;
        // هەناسە
        if (Math.abs(lt - (ph.b - ph.a) / 2) < 0.03) { sl += rnd() * 0.02; srl += rnd() * 0.02; }
      }
    }
    // کلیک و پەقین
    if ((i > sr * 1.5 && i < sr * 1.5 + 60) || (i > sr * 6.2 && i < sr * 6.2 + 45) || (i > sr * 9 && i < sr * 9 + 90)) {
      sl += rnd() * 0.5;
      srl += rnd() * 0.45;
    }
    L[i] = Math.max(-1, Math.min(1, sl * 0.9));
    R[i] = Math.max(-1, Math.min(1, srl * 0.9));
  }
  // فەیدی دەستپێک و کۆتایی
  const fade = Math.floor(sr * 0.03);
  for (let i = 0; i < fade; i++) { const g = i / fade; L[i] *= g; R[i] *= g; L[len - 1 - i] *= g; R[len - 1 - i] *= g; }
  return buf;
}
