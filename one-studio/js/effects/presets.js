/* ===== پێشڕێکخستنە ئامادەکان — بۆ قیرائەت، کاری ڕۆژانە و ئەفێکت ===== */
import { createInstance } from './chain.js';

/* هەر پێشڕێکخستنێک: {id, group, icon, chain: [{type, params}]} */
export const CHAIN_PRESETS = [
  // ---- بۆ قیرائەت ----
  {
    id: 'psQuranClean', group: 'psGroupQuran', icon: 'quran',
    chain: [
      { type: 'noiseReduce', params: { strength: 50, floor: -16, focus: 'broad' } },
      { type: 'lrFilter', params: { hpFreq: 90, lpFreq: 16000 } },
      { type: 'deesser', params: { freq: 6200, threshold: -34, amount: 55, range: 13 } },
      { type: 'compressor', params: { threshold: -22, ratio: 2.8, attack: 12, release: 200, knee: 12, makeup: 2.5 } },
      { type: 'limiter', params: { threshold: -2, ceiling: -1, release: 120 } },
    ],
  },
  {
    id: 'psQuranClear', group: 'psGroupQuran', icon: 'quran',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 105, lpFreq: 17000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 105, b1Freq: 400, b1Gain: -2.5, b2Freq: 1000, b2Gain: -0.5, b3Freq: 3000, b3Gain: 3, b4Freq: 6000, b4Gain: 1.5, hsGain: 1.5 } },
      { type: 'deesser', params: { freq: 6000, threshold: -35, amount: 60, range: 14 } },
      { type: 'compressor', params: { threshold: -23, ratio: 3, attack: 10, release: 180, knee: 12, makeup: 3 } },
    ],
  },
  {
    id: 'psQuranWarm', group: 'psGroupQuran', icon: 'quran',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 75, lpFreq: 15000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 75, lsFreq: 180, lsGain: 2.5, b1Freq: 260, b1Gain: 1.5, b3Gain: -0.5, hsGain: -0.5 } },
      { type: 'saturation', params: { drive: 1.8, mix: 15, tone: 8000, output: 0 } },
      { type: 'compressor', params: { threshold: -21, ratio: 2.6, attack: 14, release: 220, knee: 14, makeup: 2.5 } },
      { type: 'reverb', params: { roomSize: 1.1, decay: 2, predelay: 14, damping: 3800, wet: 6, dry: 100, width: 45 } },
    ],
  },
  {
    id: 'psQuranCalm', group: 'psGroupQuran', icon: 'quran',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 85, lpFreq: 14000 } },
      { type: 'compressor', params: { threshold: -18, ratio: 2, attack: 20, release: 260, knee: 18, makeup: 1.5 } },
      { type: 'reverb', params: { roomSize: 1.4, decay: 2.2, predelay: 16, damping: 4200, wet: 8, dry: 100, width: 50 } },
      { type: 'limiter', params: { threshold: -3, ceiling: -1.5, release: 200 } },
    ],
  },
  {
    id: 'psQuranFull', group: 'psGroupQuran', icon: 'quran',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 70, lpFreq: 17000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 70, lsFreq: 150, lsGain: 2, b3Freq: 2800, b3Gain: 1.5, hsGain: 1 } },
      { type: 'compressor', params: { threshold: -24, ratio: 3.4, attack: 10, release: 180, knee: 10, makeup: 4 } },
      { type: 'deesser', params: { freq: 6400, threshold: -33, amount: 55, range: 13 } },
      { type: 'limiter', params: { threshold: -2.5, ceiling: -1, release: 120 } },
    ],
  },
  {
    id: 'psQuranColumn', group: 'psGroupQuran', icon: 'quran',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 115, lpFreq: 15000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 115, b1Freq: 420, b1Gain: -4, b3Freq: 3500, b3Gain: 3.5, hsGain: 2 } },
      { type: 'deesser', params: { freq: 5800, threshold: -37, amount: 70, range: 17 } },
      { type: 'compressor', params: { threshold: -26, ratio: 4.2, attack: 8, release: 160, knee: 8, makeup: 5.5 } },
      { type: 'limiter', params: { threshold: -2, ceiling: -0.8, release: 100 } },
    ],
  },
  // ---- بۆ کاری ڕۆژانە ----
  {
    id: 'psQuickClean', group: 'psGroupDaily', icon: 'broom',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 80, lpFreq: 17000 } },
      { type: 'gate', params: { threshold: -48, attack: 5, hold: 90, release: 180, range: 55 } },
      { type: 'compressor', params: { threshold: -20, ratio: 2.5, attack: 12, release: 200, knee: 14, makeup: 2 } },
      { type: 'limiter', params: { threshold: -2, ceiling: -1, release: 120 } },
    ],
  },
  {
    id: 'psDialog', group: 'psGroupDaily', icon: 'voice',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 100, lpFreq: 14000 } },
      { type: 'compressor', params: { threshold: -20, ratio: 2.5, attack: 10, release: 160, knee: 14, makeup: 2.5 } },
      { type: 'deesser', params: { freq: 6400, threshold: -32, amount: 50, range: 12 } },
    ],
  },
  {
    id: 'psPodcast', group: 'psGroupDaily', icon: 'voice',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 85, lpFreq: 16000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 85, lsGain: 1.5, b1Freq: 350, b1Gain: -2, b3Freq: 3200, b3Gain: 2.5 } },
      { type: 'compressor', params: { threshold: -25, ratio: 3.5, attack: 8, release: 180, knee: 10, makeup: 4.5 } },
      { type: 'deesser', params: { freq: 6200, threshold: -34, amount: 60, range: 14 } },
      { type: 'limiter', params: { threshold: -1.5, ceiling: -0.8, release: 100 } },
    ],
  },
  {
    id: 'psVideo', group: 'psGroupDaily', icon: 'music',
    chain: [
      { type: 'lrFilter', params: { hpFreq: 90, lpFreq: 16500 } },
      { type: 'compressor', params: { threshold: -22, ratio: 3, attack: 10, release: 170, knee: 10, makeup: 3 } },
      { type: 'limiter', params: { threshold: -1.5, ceiling: -0.8, release: 90 } },
    ],
  },
  {
    id: 'psDenoise', group: 'psGroupDaily', icon: 'noise',
    chain: [
      { type: 'gate', params: { threshold: -50, attack: 4, hold: 80, release: 160, range: 60 } },
      { type: 'lrFilter', params: { hpFreq: 85, lpFreq: 15500 } },
    ],
  },
  // ---- ئەفێکت ----
  {
    id: 'psRevCalm', group: 'psGroupFx', icon: 'reverb',
    chain: [{ type: 'reverb', params: { roomSize: 1.2, decay: 2, predelay: 12, damping: 4500, wet: 8, dry: 100, width: 45 } }],
  },
  {
    id: 'psRevHall', group: 'psGroupFx', icon: 'reverb',
    chain: [{ type: 'reverb', params: { roomSize: 2.6, decay: 2.8, predelay: 22, damping: 5000, wet: 16, dry: 100, width: 70 } }],
  },
  {
    id: 'psDelayLight', group: 'psGroupFx', icon: 'delay',
    chain: [{ type: 'delay', params: { time: 180, feedback: 20, wet: 12, dry: 100, width: 60, lowcut: 320, highcut: 7000 } }],
  },
  {
    id: 'psWarm', group: 'psGroupFx', icon: 'saturation',
    chain: [{ type: 'saturation', params: { drive: 2.4, mix: 22, tone: 8500, output: 0 } }],
  },
  {
    id: 'psClear', group: 'psGroupFx', icon: 'eq',
    chain: [{ type: 'eq', params: { hpOn: 1, hpFreq: 100, b1Freq: 400, b1Gain: -2.5, b3Freq: 3000, b3Gain: 3, hsGain: 1.5 } }],
  },
];

/* ---- ئامانجەکانی «باشترکردنی خێرا» ---- */
export const QUICK_GOALS = [
  { id: 'clean', label: 'qeGoalClean', desc: 'qeGoalCleanD', icon: 'broom' },
  { id: 'clear', label: 'qeGoalClear', desc: 'qeGoalClearD', icon: 'eq' },
  { id: 'warm', label: 'qeGoalWarm', desc: 'qeGoalWarmD', icon: 'saturation' },
  { id: 'quran', label: 'qeGoalQuran', desc: 'qeGoalQuranD', icon: 'quran' },
  { id: 'denoise', label: 'qeGoalDenoise', desc: 'qeGoalDenoiseD', icon: 'noise' },
  { id: 'publish', label: 'qeGoalPublish', desc: 'qeGoalPublishD', icon: 'loudness' },
];

/* دروستکردنی زنجیرە بەپێی ئامانج و توندی — 0.7 نەرم / 1 مامناوەند / 1.4 بەهێز */
export function buildQuickChain(goal, intensity) {
  const k = intensity;
  const kk = (a, b) => a + (b - a) * ((k - 0.7) / 0.7); // هێڵی نێوان 0.7 و 1.4
  const chains = {
    clean: () => [
      { type: 'noiseReduce', params: { strength: kk(40, 75), floor: -16, focus: 'broad' } },
      { type: 'clickClean', params: { sensitivity: kk(45, 70), windowMs: 3 } },
      { type: 'lrFilter', params: { hpFreq: kk(75, 95), lpFreq: 17000 } },
    ],
    clear: () => [
      { type: 'lrFilter', params: { hpFreq: kk(90, 110), lpFreq: 17000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 100, b1Freq: 400, b1Gain: -kk(1.5, 3.5), b3Freq: 3000, b3Gain: kk(2, 4), hsGain: kk(1, 2) } },
      { type: 'deesser', params: { freq: 6200, threshold: -34, amount: kk(45, 75), range: kk(10, 16) } },
      { type: 'compressor', params: { threshold: -22, ratio: kk(2.5, 3.6), attack: 10, release: 180, knee: 12, makeup: kk(2.5, 4) } },
    ],
    warm: () => [
      { type: 'lrFilter', params: { hpFreq: 75, lpFreq: 15000 } },
      { type: 'eq', params: { hpOn: 1, hpFreq: 75, lsFreq: 170, lsGain: kk(1.5, 3), hsGain: -0.5 } },
      { type: 'saturation', params: { drive: kk(1.8, 3), mix: kk(15, 30), tone: 8500, output: 0 } },
      { type: 'compressor', params: { threshold: -20, ratio: kk(2.2, 3), attack: 14, release: 220, knee: 14, makeup: kk(2, 3.5) } },
    ],
    quran: () => [
      { type: 'noiseReduce', params: { strength: kk(35, 60), floor: -16, focus: 'broad' } },
      { type: 'lrFilter', params: { hpFreq: kk(85, 105), lpFreq: 16500 } },
      { type: 'deesser', params: { freq: 6200, threshold: -34, amount: kk(50, 75), range: kk(12, 16) } },
      { type: 'compressor', params: { threshold: -23, ratio: kk(2.6, 3.6), attack: 11, release: 190, knee: 12, makeup: kk(2.5, 4) } },
      { type: 'reverb', params: { roomSize: 1.1, decay: 2, predelay: 13, damping: 4200, wet: 6, dry: 100, width: 45 } },
      { type: 'limiter', params: { threshold: -2.5, ceiling: -1, release: 120 } },
    ],
    denoise: () => [
      { type: 'noiseReduce', params: { strength: kk(40, 80), floor: -15, focus: 'broad' } },
      { type: 'gate', params: { threshold: kk(-54, -46), attack: 4, hold: 80, release: 170, range: 60 } },
    ],
    publish: () => [
      { type: 'compressor', params: { threshold: kk(-18, -24), ratio: kk(2.4, 3.6), attack: 10, release: 180, knee: 12, makeup: kk(2, 4.5) } },
      { type: 'limiter', params: { threshold: kk(-3, -1.5), ceiling: -1, release: 100 } },
    ],
  };
  const defs = (chains[goal] || chains.clear)();
  return defs.map(d => createInstance(d.type, d.params));
}
