/* ===== ترنسپۆرت — پەخش، ڕاگرتن، پێش/دوای، دەنگی گشتی ===== */
import { state, emit, busOn } from '../state.js';
import { engine } from '../audio/engine.js';
import { el, icon, fmtTime } from '../utils.js';
import { t } from '../l10n.js';
import { StereoMeter } from './meters.js';

export function createTransport() {
  const root = el('div', { class: 'transport' });

  const playBtn = el('button', { class: 'tp-play', 'aria-label': t('play') });
  function renderPlay() {
    playBtn.innerHTML = icon(engine.isPlaying ? 'pause' : 'play', 22);
    playBtn.setAttribute('aria-label', engine.isPlaying ? t('pause') : t('play'));
  }
  playBtn.addEventListener('click', () => engine.togglePlay());

  const stopBtn = el('button', { class: 'tp-btn', 'aria-label': t('stop'), html: icon('stop', 17) });
  stopBtn.addEventListener('click', () => engine.stop());

  const loopBtn = el('button', { class: 'tp-btn', 'aria-label': t('loop'), html: icon('loop', 16) });
  loopBtn.addEventListener('click', () => {
    state.loop = !state.loop;
    loopBtn.classList.toggle('on', state.loop);
    if (engine.isPlaying) engine.play(engine.position);
  });

  const time = el('div', { class: 'tp-time' });
  const cur = el('span', { class: 'cur num', text: '00:00.0' });
  const dur = el('span', { class: 'dur num', text: '/ 00:00.0' });
  time.append(cur, dur);

  // پێش / دوای
  const ab = el('div', { class: 'tp-ab', role: 'group', 'aria-label': t('compare') });
  const abBefore = el('button', { class: '', text: t('before') });
  const abAfter = el('button', { class: 'on', text: t('after') });
  abBefore.addEventListener('click', () => setCompare('before'));
  abAfter.addEventListener('click', () => setCompare('after'));
  function setCompare(mode) {
    state.compare = mode;
    engine.setCompare(mode);
    abBefore.classList.toggle('on', mode === 'before');
    abAfter.classList.toggle('on', mode === 'after');
  }
  ab.append(abBefore, abAfter);

  // دەنگی گشتی + مێتەر
  const master = el('div', { class: 'tp-master' });
  const vol = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(engine.volume), class: 'vol', 'aria-label': t('masterVol') });
  const syncFill = () => { vol.style.setProperty('--fill', (vol.value * 100) + '%'); };
  vol.addEventListener('input', () => { engine.setVolume(Number(vol.value)); syncFill(); });
  syncFill();
  const meterWrap = el('div');
  const meter = new StereoMeter(meterWrap, { vertical: true });
  master.append(vol, meterWrap);
  // لە RTL دا مێتەر لە لای چەپ
  master.style.flexDirection = 'row-reverse';

  root.append(playBtn, stopBtn, loopBtn, time, ab, master);

  busOn('transport', renderPlay);
  renderPlay();

  function tick() {
    cur.textContent = fmtTime(engine.position);
    dur.textContent = '/ ' + fmtTime(state.working ? state.working.duration : 0);
    const m = engine.meters();
    if (m.active || m.out[0].peak > 0.0001) meter.update(m.out);
  }

  return { root, tick };
}
