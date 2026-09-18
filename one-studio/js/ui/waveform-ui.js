/* ===== بەشی ناوەندی ستۆدیۆ — شریتی فایل، دەستکاری، شێوەپەل و سپێکترەم ===== */
import { state, emit, pushUndo, setSelection, selSamples, busOn, setFile } from '../state.js';
import { engine, applyWorkingBuffer } from '../audio/engine.js';
import { Projects } from '../projects/store.js';
import { WaveformView } from '../audio/waveform.js';
import { SpectrumView } from './meters.js';
import { createDemoBuffer } from '../audio/demo.js';
import { el, icon, fmtTime, fmtBytes, toast, showProgress, ls } from '../utils.js';
import { t } from '../l10n.js';

export function createWaveformArea() {
  const root = el('div', { style: 'display:flex;flex-direction:column;gap:10px;min-height:0' });
  const view = new WaveformView();

  /* ---- شریتی زانیاری فایل ---- */
  const fileBar = el('div', { class: 'file-bar' });
  const fbName = el('div', { class: 'fb-name' });
  const fbMeta = el('div', { class: 'fb-meta' });
  fileBar.append(fbName, fbMeta);
  function renderFileBar() {
    fbName.innerHTML = state.working ? `${icon('music', 15)} <span></span>` : '';
    if (state.working) fbName.querySelector('span').textContent = state.fileName || t('projectUntitled');
    fbMeta.innerHTML = '';
    if (state.working) {
      const chips = [
        [t('fileInfoDuration'), fmtTime(state.working.duration, false)],
        [t('fileInfoSampleRate'), (state.working.sampleRate / 1000).toFixed(1) + ' kHz'],
        [t('fileInfoChannels'), state.working.numberOfChannels === 1 ? t('chMono') : t('chStereo')],
        [t('fileInfoSize'), fmtBytes(state.fileSize || 0)],
      ];
      for (const [k, v] of chips) {
        fbMeta.append(el('span', { class: 'chip', html: `${k}: <b class="num" style="color:var(--gold2)">${v}</b>` }));
      }
    }
  }

  /* ---- شریتی دەستکاری ---- */
  const editorBar = el('div', { class: 'editor-bar' });
  const selInfo = el('span', { class: 'zoominfo', style: 'direction:ltr' });
  function mkBtn(labelKey, iconName, onClick, tipKey = null) {
    const b = el('button', { class: 'btn', 'aria-label': t(labelKey), html: `${icon(iconName, 14)}<span>${t(labelKey)}</span>` });
    b.addEventListener('click', onClick);
    return b;
  }
  const btnCut = mkBtn('cut', 'scissors', () => editRemoveSelection(false));
  const btnDelete = mkBtn('deleteSel', 'trash', () => editRemoveSelection(true));
  const btnTrim = mkBtn('trim', 'cut', editTrim);
  const btnFadeIn = mkBtn('fadeIn', 'down', () => editFade(true));
  const btnFadeOut = mkBtn('fadeOut', 'up', () => editFade(false));
  const btnSilence = mkBtn('silenceSel', 'silence', editSilence);
  const btnSplit = mkBtn('split', 'plus', editSplit);
  const btnZoomIn = mkBtn('zoomIn', 'zoomIn', () => view.zoom(1 / 1.6));
  const btnZoomOut = mkBtn('zoomOut', 'zoomOut', () => view.zoom(1.6));
  const btnFit = mkBtn('zoomFit', 'maximize', () => view.fitAll());
  const markersBtn = mkBtn('markers', 'layers', openMarkersMenu);
  editorBar.append(btnCut, btnDelete, btnTrim, btnFadeIn, btnFadeOut, btnSilence, btnSplit, markersBtn,
    el('span', { class: 'eb-sep' }), btnZoomIn, btnZoomOut, btnFit, selInfo);

  function updateSelInfo() {
    if (state.selection) {
      const { a, b } = state.selection;
      selInfo.innerHTML = `${t('selStart')} <b class="num">${fmtTime(a)}</b> · ${t('selEnd')} <b class="num">${fmtTime(b)}</b> · ${t('selLength')} <b class="num">${fmtTime(b - a)}</b>`;
    } else {
      selInfo.textContent = t('noSelection');
    }
    [btnCut, btnDelete, btnTrim, btnFadeIn, btnFadeOut, btnSilence].forEach(b => b.disabled = !state.selection);
  }

  /* ---- کارتەکانی شێوەپەل و سپێکترەم ---- */
  const waveCard = el('div', { class: 'wave-card' });
  const waveWrap = el('div', { class: 'wave-wrap' });
  const waveCv = el('canvas', { style: 'height:250px', 'aria-label': t('waveform'), role: 'img' });
  const overviewWrap = el('div', { class: 'overview-wrap' });
  const overviewCv = el('canvas', { 'aria-label': t('timeline'), role: 'img' });
  overviewWrap.append(overviewCv);
  waveWrap.append(waveCv);
  waveCard.append(waveWrap, overviewWrap);

  const specCard = el('div', { class: 'spec-card' });
  const specHead = el('div', { class: 'spec-head', role: 'button', tabindex: '0' });
  specHead.innerHTML = `${icon('loudness', 15)} <span>${t('spectrum')}</span>
    <span class="spec-toggle">${t('p.on')}/${t('p.off')} <span class="spec-chev">${icon('down', 13)}</span></span>`;
  const specBody = el('div', { class: 'spec-body' });
  const specCv = el('canvas');
  specBody.append(specCv);
  specCard.append(specHead, specBody);
  let specOpen = ls.get('spec-open', true);
  specBody.style.display = specOpen ? 'block' : 'none';
  specHead.addEventListener('click', () => {
    specOpen = !specOpen;
    ls.set('spec-open', specOpen);
    specBody.style.display = specOpen ? 'block' : 'none';
    specCard.querySelector('.spec-chev').style.transform = specOpen ? '' : 'rotate(180deg)';
  });

  /* ---- بێ فایل ---- */
  const emptyState = el('div', { class: 'wave-card' });
  const dz = el('div', { class: 'drop-zone', role: 'button', tabindex: '0' });
  dz.innerHTML = `
    <span class="dz-ic">${icon('upload', 24)}</span>
    <b>${t('dropHere')}</b>
    <span>${t('dropOr')}</span>`;
  const pickBtn = el('button', { class: 'btn primary', html: `${icon('file', 15)} ${t('browseFile')}` });
  const demoBtn = el('button', { class: 'btn', html: `${icon('wave', 15)} ${t('demoAudio')}` });
  dz.append(pickBtn, demoBtn, el('div', { class: 'formats' }, el('span', { class: 'chip', text: t('supportedFormats') })));
  const emptyWrap = el('div', { class: 'wave-empty' });
  emptyWrap.append(
    el('div', { class: 'big-ic', html: icon('wave', 34) }),
    el('h2', { text: t('noFile') }),
    el('p', { text: t('noFileHint') }),
    dz,
  );
  emptyState.append(emptyWrap);

  root.append(fileBar, editorBar, waveCard, specCard, emptyState);

  /* ---- ئیڤنتەکانی فایل ---- */
  const fileInput = el('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac', class: 'sr-only' });
  root.append(fileInput);
  pickBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); fileInput.value = ''; });
  dz.addEventListener('click', (e) => { if (e.target === dz) fileInput.click(); });
  demoBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await engine.ensure();
    const buf = createDemoBuffer(engine.decodeCtxGet());
    setLoadedFile(buf, t('demoAudio'), 0);
    toast(t('demoAudioDesc'), 'info');
  });
  // دراپینگ
  for (const zone of [emptyState, waveCard]) {
    zone.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const f = e.dataTransfer?.files?.[0];
      if (f) loadFile(f);
    });
  }
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter') fileInput.click(); });

  async function loadFile(file) {
    const pr = showProgress({ text: t('loadingFile') });
    try {
      pr.update(0.15, t('decoding'));
      const ab = await file.arrayBuffer();
      pr.update(0.4, t('decoding'));
      const buf = await engine.decodeFile(ab);
      pr.close();
      setLoadedFile(buf, file.name, file.size, file);
    } catch (e) {
      pr.close();
      console.error(e);
      toast(t('errDecode'), 'error');
    }
  }

  function setLoadedFile(buffer, name, size, fileBlob = null) {
    engine.stop();
    state.originalFileBlob = fileBlob;
    emit('file-loaded', { buffer, name, size });
  }

  /* ---- ئۆپەرەیشنەکانی دەستکاری ---- */
  function checkSel() {
    if (!state.working) { toast(t('errNoFile'), 'warn'); return null; }
    const s = selSamples();
    if (!s) { toast(t('errNoSelection'), 'warn'); return null; }
    return s;
  }

  function editRemoveSelection(keepGap) {
    const s = checkSel(); if (!s) return;
    const channels = engine.channelData(state.working);
    const len = channels[0].length;
    const cutLen = s.i1 - s.i0;
    const newLen = len - cutLen;
    const out = channels.map(d => {
      const nd = new Float32Array(newLen);
      nd.set(d.subarray(0, s.i0));
      if (!keepGap) nd.set(d.subarray(s.i1), s.i0);
      return nd;
    });
    // keepGap=true → بڕین: بەشەکە دەگوازرێتەوە بۆ کلیپبۆردی ناوخۆیی (بەکارهێنانی داهاتوو) — لێرە هەمان سڕینەوەیە
    applyWorkingBuffer(out, state.working.sampleRate, keepGap ? t('hCut') : t('hDelete'));
    view.fitAll();
    toast(keepGap ? t('hCut') : t('hDelete'), 'success', 1800);
  }

  function editTrim() {
    const s = checkSel(); if (!s) return;
    const channels = engine.channelData(state.working);
    const out = channels.map(d => d.slice(s.i0, s.i1));
    applyWorkingBuffer(out, state.working.sampleRate, t('hTrim'));
    view.fitAll();
    toast(t('hTrim'), 'success', 1800);
  }

  function editSilence() {
    const s = checkSel(); if (!s) return;
    const channels = engine.channelData(state.working);
    const out = channels.map(d => {
      const nd = d.slice();
      nd.fill(0, s.i0, s.i1);
      return nd;
    });
    applyWorkingBuffer(out, state.working.sampleRate, t('hSilence'));
    toast(t('hSilence'), 'success', 1800);
  }

  function editFade(fadeIn) {
    const s = checkSel(); if (!s) return;
    const channels = engine.channelData(state.working);
    const n = s.i1 - s.i0;
    const out = channels.map(d => {
      const nd = d.slice();
      for (let i = 0; i < n; i++) {
        const g = fadeIn ? i / n : 1 - i / n;
        nd[s.i0 + i] *= g;
      }
      return nd;
    });
    applyWorkingBuffer(out, state.working.sampleRate, fadeIn ? t('hFadeIn') : t('hFadeOut'));
    toast(fadeIn ? t('hFadeIn') : t('hFadeOut'), 'success', 1800);
  }

  function editSplit() {
    if (!state.working) { toast(t('errNoFile'), 'warn'); return; }
    const pos = engine.position;
    const markers = [...state.markers, pos];
    state.markers = markers;
    pushUndo({
      log: t('hSplit'),
      undo() { state.markers = state.markers.filter(m => m !== pos); emit('markers'); },
      redo() { state.markers = markers; emit('markers'); },
    }, t('hSplit'));
    emit('markers');
    toast(t('hSplit') + ' — ' + fmtTime(pos), 'success', 1800);
  }

  function openMarkersMenu() {
    if (!state.markers?.length) { toast(t('noMarkers'), 'info'); return; }
    import('./dialogs.js').then(({ openMarkersDialog }) => openMarkersDialog());
  }

  /* ---- نوێکردنەوە ---- */
  busOn('file', () => {
    renderFileBar();
    updateSelInfo();
    const has = !!state.working;
    emptyState.classList.toggle('hidden', has);
    waveCard.classList.toggle('hidden', !has);
    fileBar.classList.toggle('hidden', !has);
    editorBar.classList.toggle('hidden', !has);
    if (has) {
      view.attach(waveCv, overviewCv);
      view.fitAll();
    }
  });
  busOn('selection', updateSelInfo);
  busOn('file-loaded', ({ buffer, name, size }) => {
    // وەرگرتنی فایل لە ستۆدیۆ
    import('../state.js').then(({ setFile }) => {
      setFile(buffer, name, size);
      renderFileBar();
    });
  });

  const spectrum = new SpectrumView(specCv);
  view.attach(waveCv, overviewCv);

  return {
    root, view, spectrum, fileInput, loadFile,
    ops: {
      cut: () => editRemoveSelection(false),
      remove: () => editRemoveSelection(true),
      trim: editTrim,
      fadeIn: () => editFade(true),
      fadeOut: () => editFade(false),
      silence: editSilence,
      split: editSplit,
    },
    tick() {
      view.tick();
      if (specOpen) spectrum.draw();
    },
  };
}
