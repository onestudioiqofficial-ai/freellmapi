/* ===== دیالۆگەکان — هەناردەکردن، ئامرازە ئۆفلاینەکان، پێشڕێکخستن و ... ===== */
import { state, emit, pushUndo, replaceChain, logHistory } from '../state.js';
import { engine, applyWorkingBuffer } from '../audio/engine.js';
import { renderProcessed, encodeWav, encodeMp3, encodeOgg, supportedFormats, downloadBlob } from '../audio/exporter.js';
import { REGISTRY } from '../effects/registry.js';
import { QUICK_GOALS, buildQuickChain, CHAIN_PRESETS } from '../effects/presets.js';
import { runOp } from '../workers/client.js';
import { Projects } from '../projects/store.js';
import { el, icon, modal, toast, showProgress, fmtTime, fmtBytes, fmtDb, ls, uid } from '../utils.js';
import { t } from '../l10n.js';

/* ---------- پێشبینینی A/B بۆ ئامرازە ئۆفلاینەکان ---------- */
class PreviewAB {
  constructor() {
    this.src = null;
    this.tag = null;
  }
  async play(buffer, tag) {
    await engine.ensure();
    this.stop();
    if (!buffer) return;
    const s = engine.ctx.createBufferSource();
    s.buffer = buffer;
    const g = engine.ctx.createGain();
    s.connect(g); g.connect(engine.ctx.destination);
    s.start();
    this.src = s;
    this.tag = tag;
  }
  stop() {
    if (this.src) { try { this.src.stop(); } catch {} this.src = null; }
    this.tag = null;
  }
}

/* ---------- ڕێکخستنی شێوەی سلاید بۆ دیالۆگەکان ---------- */
function sliderRow(label, min, max, step, value, onInput, fmt = (v) => String(v)) {
  const row = el('div', { class: 'field' });
  const lab = el('label', {});
  lab.innerHTML = `${t(label)} <b class="num" style="color:var(--gold2)">${fmt(value)}</b>`;
  const inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  inp.addEventListener('input', () => {
    const v = Number(inp.value);
    lab.querySelector('b').textContent = fmt(v);
    onInput(v);
  });
  row.append(lab, inp);
  return row;
}
function selectRow(label, options, value, onChange, fmtOpt = (o) => o.label) {
  const row = el('div', { class: 'field' });
  row.append(el('label', { text: t(label) }));
  const sel = el('select', { class: 'input' });
  for (const o of options) sel.append(el('option', { value: String(o.v), text: o.label !== undefined ? o.label : t(o.k) }));
  sel.value = String(value);
  sel.addEventListener('change', () => {
    const raw = typeof options[0].v === 'number' ? Number(sel.value) : sel.value;
    onChange(raw);
  });
  row.append(sel);
  return row;
}

/* ================================================================
 * هەناردەکردن
 * ============================================================== */
export async function openExportDialog() {
  if (!state.working) { toast(t('errNoFile'), 'warn'); return; }
  const formats = await supportedFormats();
  let format = 'wav';
  let bitDepth = 16, mp3Bitrate = 192;
  let sampleRate = 0, channels = 0;
  let outBlob = null;
  let renderBtn = null, dlBtn = null;

  const md = modal({
    title: t('exportTitle'),
    body(b, md) {
      const fmtRow = selectRow('exportFormat', [
        { v: 'wav', label: 'WAV — ' + t('exportBit32').split(' (')[0] + ' / بێ لەدەستدان' },
        ...(formats.mp3 ? [{ v: 'mp3', label: 'MP3 — بچووکتر' }] : []),
        ...(formats.ogg ? [{ v: 'ogg', label: 'OGG (Opus)' }] : []),
      ], 'wav', (v) => { format = v; updateQuality(); });
      b.append(fmtRow);

      const qualityWrap = el('div', { id: 'exp-quality' });
      b.append(qualityWrap);

      function updateQuality() {
        qualityWrap.innerHTML = '';
        if (format === 'wav') {
          qualityWrap.append(selectRow('exportQuality', [
            { v: 16, label: t('exportBit16') }, { v: 24, label: t('exportBit24') }, { v: 32, label: t('exportBit32') },
          ], bitDepth, (v) => bitDepth = v));
        } else if (format === 'mp3') {
          qualityWrap.append(selectRow('exportQuality', [
            { v: 128, label: '128 kbps' }, { v: 192, label: '192 kbps' }, { v: 256, label: '256 kbps' }, { v: 320, label: '320 kbps' },
          ], mp3Bitrate, (v) => mp3Bitrate = v));
        } else {
          qualityWrap.append(el('p', { style: 'color:var(--tx2);font-size:12.5px;margin:4px 0', text: 'Opus 192 kbps' }));
        }
      }
      updateQuality();

      b.append(selectRow('exportSampleRate', [
        { v: 0, label: t('exportKeep') + ` (${(state.working.sampleRate / 1000).toFixed(1)} kHz)` },
        { v: 44100, label: '44.1 kHz' }, { v: 48000, label: '48 kHz' },
      ], 0, (v) => sampleRate = v));
      b.append(selectRow('exportChannels', [
        { v: 0, label: t('exportKeep') }, { v: 1, label: t('exportMono') }, { v: 2, label: t('exportStereo') },
      ], 0, (v) => channels = v));

      const nameField = el('div', { class: 'field' });
      nameField.append(el('label', { text: t('exportFilename') }));
      const nameInp = el('input', { class: 'input', type: 'text', dir: 'ltr', value: (state.project?.name || 'one-studio').replace(/[\\/:*?"<>|]/g, '') });
      nameField.append(nameInp);
      b.append(nameField);

      const status = el('div', { style: 'margin-top:6px' });
      b.append(status);

      // کردارەکان — فوتەر دوای دروستکردن پڕ دەکرێتەوە
      renderBtn = el('button', { class: 'btn primary', html: `${icon('export', 15)} ${t('exportRender')}` });
      dlBtn = el('button', { class: 'btn hidden', html: `${icon('download', 15)} ${t('exportDownload')}` });

      renderBtn.addEventListener('click', async () => {
        renderBtn.disabled = true;
        dlBtn.classList.add('hidden');
        const pr = showProgress({ text: t('exportRendering'), cancelable: false });
        try {
          pr.update(0.05);
          const rendered = await renderProcessed({
            sampleRate: sampleRate || null,
            channels: channels || null,
            onProgress: (p) => pr.update(0.05 + p * 0.55, t('exportRendering')),
          });
          pr.update(0.65, t('exportEncoding'));
          if (format === 'wav') outBlob = await encodeWav(rendered, bitDepth, (p) => pr.update(0.65 + p * 0.35, t('exportEncoding')));
          else if (format === 'mp3') outBlob = await encodeMp3(rendered, mp3Bitrate, (p) => pr.update(0.65 + p * 0.35, t('exportEncoding')));
          else outBlob = await encodeOgg(rendered, (p) => pr.update(0.65 + p * 0.35, t('exportEncoding')));
          pr.close();
          status.innerHTML = `<span class="badge green">${icon('check', 12)} ${t('exportDone')}</span>
            <span class="chip" style="margin-inline-start:8px">${t('exportSize')}: <b class="num">${fmtBytes(outBlob.size)}</b></span>`;
          dlBtn.classList.remove('hidden');
          dlBtn.onclick = () => {
            const ext = format === 'wav' ? 'wav' : format;
            downloadBlob(outBlob, (nameInp.value || 'one-studio') + '.' + ext);
            toast(t('exported'), 'success');
            logHistory(t('export') + ' — ' + ext.toUpperCase());
          };
        } catch (e) {
          pr.close();
          console.error(e);
          toast(e.message === 'cancelled' ? t('procCancelled') : t('errExport'), 'error');
        }
        renderBtn.disabled = false;
      });
    },
  });
  md.root.querySelector('.modal-foot').append(renderBtn, dlBtn);
}

/* ================================================================
 * ئامرازە ئۆفلاینەکان
 * ============================================================== */
export async function openNoiseDialog(tool, params) {
  const def = REGISTRY.noiseReduce;
  let profile = null;
  let previewBuf = null;
  let previewParams = null;
  const ab = new PreviewAB();
  engine.pause();
  const P = { ...params };

  const md = modal({
    title: t(tool.label),
    onClose() { ab.stop(); state.tempRegions = null; emit('selection'); },
    body(b, md) {
      const info = el('div', { class: 'fx-note info', html: `${icon('info', 14)}<span>${t('noiseLearnHint')}</span>` });
      b.append(info);
      // پارامیتەرەکان
      const strengthRow = sliderRow('p.strength', 0, 100, 1, P.strength, (v) => { P.strength = v; invalidate(); }, (v) => v + '٪');
      const floorRow = sliderRow('p.floor', -30, -5, 1, P.floor, (v) => { P.floor = v; invalidate(); }, (v) => v + ' dB');
      const focusRow = selectRow('p.style', [
        { v: 'broad', k: 'tNoise' }, { v: 'hiss', k: 'tHiss' },
      ], P.focus, (v) => { P.focus = v; invalidate(); });
      const grid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:0 22px' });
      grid.append(strengthRow, focusRow, floorRow);
      b.append(grid);

      const learnRow = el('div', { class: 'dash-row', style: 'margin:10px 0' });
      const learnSel = el('button', { class: 'btn small', html: `${icon('search', 13)} ${t('learnSel')}` });
      const learnFirst = el('button', { class: 'btn small', html: `${icon('clock', 13)} ${t('learnFirst')}` });
      const learnInfo = el('span', { style: 'font-size:12px;color:var(--tx1)' });
      learnRow.append(learnSel, learnFirst, learnInfo);
      b.append(learnRow);

      async function learn(aSec, bSec) {
        const pr = showProgress({ text: t('procLearning') });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('noiseProfile', {
            channels, sampleRate: state.working.sampleRate, aSec, bSec, frame: 2048,
          });
          profile = res;
          pr.close();
          learnInfo.innerHTML = `<span class="badge green">${icon('check', 11)} ${t('noiseLearned')}</span>`;
          invalidate();
        } catch (e) {
          pr.close();
          toast(t('errProcess'), 'error');
        }
      }
      learnFirst.addEventListener('click', () => learn(0, Math.min(0.6, state.working.duration)));
      learnSel.addEventListener('click', () => {
        if (!state.selection) { toast(t('errNoSelection'), 'warn'); return; }
        learn(state.selection.a, state.selection.b);
      });

      // پێشبینین A/B
      const prevRow = el('div', { class: 'dash-row', style: 'margin-top:6px' });
      const prevBtn = el('button', { class: 'btn small', html: `${icon('play', 13)} ${t('presetPreview')}` });
      const stopBtn = el('button', { class: 'btn small ghost', html: `${icon('stop', 13)} ${t('stop')}` });
      const abInfo = el('span', { style: 'font-size:12px;color:var(--tx1)' });
      prevRow.append(prevBtn, stopBtn, abInfo);
      b.append(prevRow);

      function invalidate() { previewBuf = null; previewParams = null; }
      async function ensurePreview() {
        if (previewBuf && JSON.stringify(previewParams) === JSON.stringify(P)) return previewBuf;
        if (!profile) await new Promise(r => { learn(0, Math.min(0.6, state.working.duration)).then(r); });
        const pr = showProgress({ text: t('procCleaning'), cancelable: true });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('denoise', {
            channels, sampleRate: state.working.sampleRate, profile, opts: { ...P },
          }, { onProgress: (p) => pr.update(p) });
          pr.close();
          previewBuf = engine.makeBuffer(res.channels, state.working.sampleRate);
          previewParams = { ...P };
          return previewBuf;
        } catch (e) {
          pr.close();
          if (e.message !== 'cancelled') toast(t('errProcess'), 'error');
          return null;
        }
      }
      prevBtn.addEventListener('click', async () => {
        const buf = await ensurePreview();
        if (buf) { ab.play(buf, 'after'); abInfo.innerHTML = `<span class="badge amber">${t('presetPreviewing')}</span>`; }
      });
      stopBtn.addEventListener('click', () => { ab.stop(); abInfo.innerHTML = ''; });

      // جێبەجێکردن لە فوتەر
      const applyBtn = el('button', { class: 'btn primary', html: `${icon('check', 15)} ${t('applyBake')}` });
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        const buf = await ensurePreview();
        if (!buf) { applyBtn.disabled = false; return; }
        ab.stop();
        const channels = [];
        for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
        applyWorkingBuffer(channels, buf.sampleRate, t('hDenoise'));
        md.close();
        toast(t('hDenoise'), 'success');
      });
      md.root.querySelector('.modal-foot').append(applyBtn);

      // فێربوونی سەرەتایی
      learn(0, Math.min(0.6, state.working.duration));
    },
  });
}

export async function openSilenceDialog(tool, params) {
  const P = { ...params };
  engine.pause();
  const md = modal({
    title: t('tSilenceRemove'),
    onClose() { state.tempRegions = null; emit('selection'); },
    body(b, md) {
      b.append(sliderRow('p.threshold', -60, -20, 1, P.thresholdDb, (v) => { P.thresholdDb = v; }, (v) => v + ' dB'));
      b.append(sliderRow('p.minDur', 0.1, 3, 0.05, P.minDur, (v) => { P.minDur = v; }, (v) => v.toFixed(2) + ' ' + t('uSec')));
      b.append(sliderRow('p.padding', 0, 0.5, 0.01, P.pad, (v) => { P.pad = v; }, (v) => v.toFixed(2) + ' ' + t('uSec')));
      const result = el('div', { style: 'margin:10px 0' });
      b.append(result);
      let regions = [];
      const detectBtn = el('button', { class: 'btn small', html: `${icon('search', 13)} ${t('procAnalyzing')}` });
      const prevBtn = el('button', { class: 'btn small', html: `${icon('play', 13)} ${t('play')}` });
      detectBtn.addEventListener('click', async () => {
        const pr = showProgress({ text: t('procAnalyzing') });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('silences', { channels, sampleRate: state.working.sampleRate, opts: P });
          regions = res.regions;
          pr.close();
          state.tempRegions = regions;
          emit('selection');
          result.innerHTML = regions.length
            ? `<span class="badge amber">${icon('silence', 12)} ${t('regionsFound')(regions.length)}</span>
               <div style="font-size:12px;color:var(--tx1);margin-top:6px">${regions.slice(0, 12).map(r => `<span class="num">${fmtTime(r.a)}–${fmtTime(r.b)}</span>`).join(' · ')}</div>`
            : `<span class="badge gray">${t('noMarkers')}</span>`;
        } catch (e) { pr.close(); toast(t('errProcess'), 'error'); }
      });
      prevBtn.addEventListener('click', () => {
        if (!regions.length) { toast(t('procAnalyzing'), 'info'); return; }
        engine.play(regions[0].a);
      });
      b.append(el('div', { class: 'dash-row' }, detectBtn, prevBtn));
      const applyBtn = el('button', { class: 'btn primary', html: `${icon('check', 15)} ${t('applyBake')}` });
      applyBtn.addEventListener('click', async () => {
        if (!regions.length) { toast(t('procAnalyzing'), 'warn'); return; }
        const pr = showProgress({ text: t('procApplying') });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('cutSilences', { channels, sampleRate: state.working.sampleRate, regions, pad: P.pad });
          pr.close();
          applyWorkingBuffer(res.channels, state.working.sampleRate, t('hSilence'));
          md.close();
          toast(t('tSilenceRemove') + ' — ' + t('apply'), 'success');
        } catch (e) { pr.close(); toast(t('errProcess'), 'error'); }
      });
      md.root.querySelector('.modal-foot').append(applyBtn);
    },
  });
}

export async function openClickDialog(tool, params) {
  const P = { ...params };
  let previewBuf = null, previewParams = null;
  const ab = new PreviewAB();
  engine.pause();
  const md = modal({
    title: t('tClicks'),
    onClose() { ab.stop(); },
    body(b, md) {
      b.append(sliderRow('p.sensitivity', 0, 100, 1, P.sensitivity, (v) => { P.sensitivity = v; previewBuf = null; }, (v) => v + '٪'));
      b.append(sliderRow('p.window', 1, 10, 0.5, P.windowMs, (v) => { P.windowMs = v; previewBuf = null; }, (v) => v + ' ms'));
      const result = el('div', { style: 'margin:8px 0' });
      b.append(result);
      const prevBtn = el('button', { class: 'btn small', html: `${icon('play', 13)} ${t('presetPreview')}` });
      const stopBtn = el('button', { class: 'btn small ghost', html: `${icon('stop', 13)} ${t('stop')}` });
      b.append(el('div', { class: 'dash-row' }, prevBtn, stopBtn));

      async function ensurePreview() {
        if (previewBuf && JSON.stringify(previewParams) === JSON.stringify(P)) return { buf: previewBuf, count: previewCount };
        const pr = showProgress({ text: t('procCleaning'), cancelable: true });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('clicks', {
            channels, sampleRate: state.working.sampleRate,
            opts: { sensitivity: P.sensitivity / 100, windowMs: P.windowMs },
          }, { onProgress: (p) => pr.update(p) });
          pr.close();
          previewBuf = engine.makeBuffer(res.channels, state.working.sampleRate);
          previewParams = { ...P };
          previewCount = res.clicks;
          result.innerHTML = `<span class="badge amber">${icon('clicks', 12)} ${t('clicksFound')(res.clicks)}</span>`;
          return { buf: previewBuf, count: res.clicks };
        } catch (e) {
          pr.close();
          if (e.message !== 'cancelled') toast(t('errProcess'), 'error');
          return null;
        }
      }
      let previewCount = 0;
      prevBtn.addEventListener('click', async () => {
        const r = await ensurePreview();
        if (r) ab.play(r.buf, 'after');
      });
      stopBtn.addEventListener('click', () => ab.stop());

      const applyBtn = el('button', { class: 'btn primary', html: `${icon('check', 15)} ${t('applyBake')}` });
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        const r = await ensurePreview();
        if (!r) { applyBtn.disabled = false; return; }
        ab.stop();
        const channels = [];
        for (let c = 0; c < r.buf.numberOfChannels; c++) channels.push(r.buf.getChannelData(c).slice());
        applyWorkingBuffer(channels, r.buf.sampleRate, t('hClicks'));
        md.close();
        toast(t('hClicks'), 'success');
      });
      md.root.querySelector('.modal-foot').append(applyBtn);
    },
  });
}

export async function openPitchDialog(tool, params) {
  const P = { ...params };
  const ab = new PreviewAB();
  engine.pause();
  const md = modal({
    title: t('tPitch'),
    onClose() { ab.stop(); },
    body(b, md) {
      const stLab = el('div', {});
      const stRow = sliderRow('p.semitone', -12, 12, 1, P.semitones, (v) => { P.semitones = v; stLab.textContent = ''; }, (v) => (v > 0 ? '+' : '') + v);
      const fineRow = sliderRow('p.fine', -100, 100, 1, P.fine, (v) => { P.fine = v; stLab.textContent = ''; }, (v) => (v > 0 ? '+' : '') + v);
      stRow.append(stLab);
      b.append(stRow, fineRow);
      b.append(el('p', { style: 'font-size:12px;color:var(--tx2)', text: 'درێژی دەنگ وەک خۆی دەمێنێتەوە — تەنها بەرزی تۆن دەگۆڕدرێت.' }));
      const prevBtn = el('button', { class: 'btn small', html: `${icon('play', 13)} ${t('presetPreview')}` });
      const stopBtn = el('button', { class: 'btn small ghost', html: `${icon('stop', 13)} ${t('stop')}` });
      b.append(el('div', { class: 'dash-row' }, prevBtn, stopBtn));

      async function ensurePreview() {
        if (P.semitones === 0 && P.fine === 0) { toast(t('p.semitone') + ' = 0', 'info'); return null; }
        const pr = showProgress({ text: t('procApplying'), cancelable: true });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('pitch', {
            channels, sampleRate: state.working.sampleRate,
            semitones: P.semitones + P.fine / 100,
          }, { onProgress: (p) => pr.update(p) });
          pr.close();
          return engine.makeBuffer(res.channels, state.working.sampleRate);
        } catch (e) {
          pr.close();
          if (e.message !== 'cancelled') toast(t('errProcess'), 'error');
          return null;
        }
      }
      prevBtn.addEventListener('click', async () => { const buf = await ensurePreview(); if (buf) ab.play(buf); });
      stopBtn.addEventListener('click', () => ab.stop());
      const applyBtn = el('button', { class: 'btn primary', html: `${icon('check', 15)} ${t('applyBake')}` });
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        const buf = await ensurePreview();
        if (!buf) { applyBtn.disabled = false; return; }
        ab.stop();
        const channels = [];
        for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
        applyWorkingBuffer(channels, buf.sampleRate, t('hPitch'));
        md.close();
        toast(t('hPitch'), 'success');
      });
      md.root.querySelector('.modal-foot').append(applyBtn);
    },
  });
}

export async function openSpeedDialog(tool, params) {
  const P = { ...params };
  const ab = new PreviewAB();
  engine.pause();
  const md = modal({
    title: t('tSpeed'),
    onClose() { ab.stop(); },
    body(b, md) {
      b.append(selectRow('p.rate', [
        { v: 0.5, label: '0.5×' }, { v: 0.75, label: '0.75×' }, { v: 1, label: '1×' },
        { v: 1.25, label: '1.25×' }, { v: 1.5, label: '1.5×' }, { v: 2, label: '2×' },
      ], P.rate, (v) => { P.rate = v; }));
      const pr = el('label', { class: 'check-row' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!P.preserve;
      cb.addEventListener('change', () => { P.preserve = cb.checked ? 1 : 0; });
      pr.append(cb, el('span', { text: t('p.preserve') }));
      b.append(pr);
      const info = el('p', { style: 'font-size:12px;color:var(--tx2)' });
      b.append(info);
      const updateInfo = () => {
        const d = state.working.duration;
        info.innerHTML = `${t('fileInfoDuration')}: <span class="num">${fmtTime(d)}</span> → <span class="num">${fmtTime(d / P.rate)}</span>`;
      };
      updateInfo();

      async function ensurePreview() {
        if (P.rate === 1) { toast('1× = ' + t('after'), 'info'); return null; }
        const pr = showProgress({ text: t('procApplying'), cancelable: true });
        try {
          const channels = engine.channelData(state.working);
          const res = await runOp('speed', {
            channels, sampleRate: state.working.sampleRate, rate: P.rate, preserve: !!P.preserve,
          }, { onProgress: (p) => pr.update(p) });
          pr.close();
          return engine.makeBuffer(res.channels, state.working.sampleRate);
        } catch (e) {
          pr.close();
          if (e.message !== 'cancelled') toast(t('errProcess'), 'error');
          return null;
        }
      }
      const prevBtn = el('button', { class: 'btn small', html: `${icon('play', 13)} ${t('presetPreview')}` });
      const stopBtn = el('button', { class: 'btn small ghost', html: `${icon('stop', 13)} ${t('stop')}` });
      prevBtn.addEventListener('click', async () => { const buf = await ensurePreview(); if (buf) ab.play(buf); });
      stopBtn.addEventListener('click', () => ab.stop());
      b.append(el('div', { class: 'dash-row' }, prevBtn, stopBtn));

      const applyBtn = el('button', { class: 'btn primary', html: `${icon('check', 15)} ${t('applyBake')}` });
      applyBtn.addEventListener('click', async () => {
        applyBtn.disabled = true;
        const buf = await ensurePreview();
        if (!buf) { applyBtn.disabled = false; return; }
        ab.stop();
        const channels = [];
        for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice());
        applyWorkingBuffer(channels, buf.sampleRate, t('hSpeed'));
        md.close();
        toast(t('hSpeed'), 'success');
      });
      md.root.querySelector('.modal-foot').append(applyBtn);
    },
  });
}

/* ================================================================
 * پێوانەی بەرزی — نۆرمال و لائودنێس
 * ============================================================== */
async function measureNow(resultEl) {
  const pr = showProgress({ text: t('procMeasuring'), cancelable: true });
  try {
    const channels = engine.channelData(state.working);
    const res = await runOp('loudness', { channels, sampleRate: state.working.sampleRate }, { onProgress: (p) => pr.update(p) });
    pr.close();
    resultEl.innerHTML = `
      <div class="dash-row" style="gap:8px;margin-top:6px">
        <span class="chip">${t('measuredPeak')}: <b class="num">${fmtDb(res.peakDb)}</b></span>
        <span class="chip">${t('measuredRms')}: <b class="num">${fmtDb(res.rmsDb)}</b></span>
        <span class="chip gold">${t('measuredLufs')}: <b class="num">${isFinite(res.lufs) ? res.lufs.toFixed(1) + ' LUFS' : '—'}</b></span>
      </div>`;
    return res;
  } catch (e) {
    pr.close();
    toast(t('errProcess'), 'error');
    return null;
  }
}

function addGainFx(gainDb, name) {
  const { addChainEffect } = Promise;
  const { createInstance } = arguments;
}

export function openNormalizeDialog() {
  if (!state.working) { toast(t('errNoFile'), 'warn'); return; }
  engine.pause();
  let gainDb = 0;
  const md = modal({
    title: t('tNormalize'),
    body(b, md) {
      const result = el('div');
      b.append(result);
      b.append(selectRow('p.target', [
        { v: -0.3, label: '-0.3 dB' }, { v: -1, label: '-1 dB' }, { v: -3, label: '-3 dB' },
      ], -1, (v) => { if (measured) gainDb = v - measured.peakDb; }));
      const measureBtn = el('button', { class: 'btn small', html: `${icon('loudness', 13)} ${t('procMeasuring')}` });
      measureBtn.addEventListener('click', async () => {
        measured = await measureNow(result);
        if (measured) {
          gainDb = targetVal - measured.peakDb;
          gainInfo.innerHTML = `${t('p.makeup')}: <b class="num">${fmtDb(gainDb)}</b>`;
        }
      });
      let measured = null;
      let targetVal = -1;
      const gainInfo = el('div', { style: 'font-size:12.5px;color:var(--tx1);margin:6px 0' });
      b.append(el('div', { class: 'dash-row' }, measureBtn), gainInfo);

      const asFx = el('button', { class: 'btn', html: `${icon('gain', 14)} ${t('applyAsFx')}` });
      const bake = el('button', { class: 'btn primary', html: `${icon('check', 14)} ${t('applyBake')}` });
      asFx.addEventListener('click', async () => {
        if (!measured) { toast(t('procMeasuring'), 'warn'); return; }
        const { addChainEffect } = await import('./tool-actions.js');
        addChainEffect('gain', { outGain: Math.round(gainDb * 10) / 10 });
        emit('chain');
        md.close();
        toast(t('gainApplied')(fmtDb(gainDb)), 'success');
      });
      bake.addEventListener('click', async () => {
        if (!measured) { toast(t('procMeasuring'), 'warn'); return; }
        const g = Math.pow(10, gainDb / 20);
        const channels = engine.channelData(state.working).map(d => d.map(x => x * g));
        applyWorkingBuffer(channels, state.working.sampleRate, t('hNormalize'));
        md.close();
        toast(t('hNormalize') + ' — ' + fmtDb(gainDb), 'success');
      });
      md.root.querySelector('.modal-foot').append(asFx, bake);
    },
  });
}

export function openLoudnessDialog() {
  if (!state.working) { toast(t('errNoFile'), 'warn'); return; }
  engine.pause();
  const TARGETS = [
    { v: -16, label: 'بۆ مۆبایل (-16 LUFS)' },
    { v: -14, label: 'بۆ ڤیدیۆ (-14 LUFS)' },
    { v: -13, label: 'بۆ بڵاوکردنەوە (-13 LUFS)' },
    { v: -23, label: 'بۆ ئەرشیف (-23 LUFS)' },
  ];
  let target = -16, measured = null, gainDb = 0;
  const md = modal({
    title: t('tLoudness'),
    body(b, md) {
      const result = el('div');
      b.append(result);
      const measureBtn = el('button', { class: 'btn small', html: `${icon('loudness', 13)} ${t('procMeasuring')}` });
      b.append(el('div', { class: 'dash-row', style: 'margin-bottom:8px' }, measureBtn));
      b.append(selectRow('p.target', TARGETS, target, (v) => {
        target = v;
        if (measured) { gainDb = target - measured.lufs; updateGain(); }
      }));
      const gainInfo = el('div', { style: 'font-size:12.5px;color:var(--tx1)' });
      b.append(gainInfo);
      function updateGain() {
        gainInfo.innerHTML = `${t('p.makeup')}: <b class="num">${gainDb >= 0 ? '+' : ''}${gainDb.toFixed(1)} dB</b>`;
      }
      measureBtn.addEventListener('click', async () => {
        measured = await measureNow(result);
        if (measured && isFinite(measured.lufs)) { gainDb = Math.max(-24, Math.min(24, target - measured.lufs)); updateGain(); }
      });
      const asFx = el('button', { class: 'btn', html: `${icon('gain', 14)} ${t('applyAsFx')}` });
      const bake = el('button', { class: 'btn primary', html: `${icon('check', 14)} ${t('applyBake')}` });
      asFx.addEventListener('click', async () => {
        if (!measured || !isFinite(measured.lufs)) { toast(t('procMeasuring'), 'warn'); return; }
        const { addChainEffect } = await import('./tool-actions.js');
        addChainEffect('gain', { outGain: Math.round(gainDb * 10) / 10 });
        emit('chain');
        md.close();
        toast(t('gainApplied')(fmtDb(gainDb)), 'success');
      });
      bake.addEventListener('click', async () => {
        if (!measured || !isFinite(measured.lufs)) { toast(t('procMeasuring'), 'warn'); return; }
        const g = Math.pow(10, gainDb / 20);
        const channels = engine.channelData(state.working).map(d => d.map(x => x * g));
        applyWorkingBuffer(channels, state.working.sampleRate, t('hNormalize'));
        md.close();
        toast(t('hNormalize'), 'success');
      });
      md.root.querySelector('.modal-foot').append(asFx, bake);
    },
  });
}

/* ================================================================
 * جیاکردنەوەی دەنگ — ڕاستگۆیانە
 * ============================================================== */
export function openVocalSepDialog() {
  modal({
    title: t('vsTitle'),
    body(b, md) {
      b.append(el('div', { class: 'fx-note', html: `${icon('alert', 15)}<span><b>${t('vsUnavailable')}</b><br>${t('vsBody')}</span>` }));
      b.append(el('p', { class: 'ltr', style: 'font-size:11.5px;color:var(--tx2);direction:ltr;text-align:left', text: t('vsAdapter') }));
    },
    actions: [el('button', { class: 'btn ghost', text: t('close'), onclick: (e) => e.target.closest('.modal-back').remove() })],
  });
}

/* ================================================================
 * پێشڕێکخستنەکان
 * ============================================================== */
const customPresets = {
  get: () => ls.get('custom-presets', []),
  set: (v) => ls.set('custom-presets', v),
};
const favPresets = {
  get: () => ls.get('fav-presets', {}),
  toggle(id) { const f = this.get(); if (f[id]) delete f[id]; else f[id] = 1; ls.set('fav-presets', f); return !!f[id]; },
};

export function openPresetsDialog() {
  let presetAb = null; // دەڕوێت کە مۆداڵ داخرا
  const md = modal({
    title: t('presetsTitle'), wide: true,
    onClose() { presetAb?.stop(); presetAb = null; state.presetPreview = null; },
    body(b, md) {
      const ab = new PreviewAB();
      presetAb = ab;
      let previewing = null;

      const tabs = el('div', { class: 'dash-row', style: 'margin-bottom:14px' });
      const listWrap = el('div');
      b.append(tabs, listWrap);

      const groups = ['psGroupQuran', 'psGroupDaily', 'psGroupFx', 'presetCustom'];
      let cur = groups[0];
      for (const g of groups) {
        const btn = el('button', { class: 'btn small' + (g === cur ? ' toggle-on' : ''), text: t(g) });
        btn.addEventListener('click', () => {
          cur = g;
          [...tabs.children].forEach((x, i) => x.classList.toggle('toggle-on', groups[i] === g));
          render();
        });
        tabs.append(btn);
      }

      async function previewChain(chain, id, btn) {
        if (previewing === id) { ab.stop(); previewing = null; btn.innerHTML = `${icon('play', 13)} ${t('presetPreview')}`; return; }
        engine.pause();
        const pr = showProgress({ text: t('presetPreview') });
        try {
          const rendered = await renderProcessed({ chain });
          pr.close();
          previewing = id;
          await ab.play(rendered, id);
          btn.innerHTML = `${icon('stop', 13)} ${t('presetStopPreview')}`;
        } catch (e) { pr.close(); toast(t('errProcess'), 'error'); }
      }

      function card(title, icon_, chain, presetId, custom = false) {
        const c = el('div', { class: 'card hover', style: 'padding:14px' });
        c.innerHTML = `
          <div style="display:flex;align-items:center;gap:9px;margin-bottom:8px">
            <span class="ti-ic" style="width:34px;height:34px;border-radius:10px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center">${icon(icon_, 16)}</span>
            <b style="font-family:var(--font-h);font-size:13.5px;flex:1">${title}</b>
          </div>
          <div style="font-size:11.5px;color:var(--tx2);margin-bottom:10px">${chain.map(x => REGISTRY[x.type] ? t(REGISTRY[x.type].label) : x.type).join(' ← ')}</div>`;
        const row = el('div', { class: 'dash-row' });
        const prevBtn = el('button', { class: 'btn small', html: `${icon('play', 13)} ${t('presetPreview')}` });
        prevBtn.addEventListener('click', () => previewChain(chain, presetId, prevBtn));
        const applyBtn = el('button', { class: 'btn small primary', html: `${icon('check', 13)} ${t('presetApply')}` });
        applyBtn.addEventListener('click', () => {
          ab.stop();
          const instances = chain.map(d => ({ uid: uid(), type: d.type, params: { ...d.params }, enabled: true, bypassed: false }));
          replaceChain(instances, t('hPreset') + ': ' + title);
          md.close();
          toast(t('presetApplied') + ' — ' + title, 'success');
        });
        const fav = el('button', {
          class: 'mini-btn' + (favPresets.get()[presetId] ? ' danger' : ''),
          'aria-label': t('presetFav'), html: icon('star', 14),
        });
        fav.style.color = favPresets.get()[presetId] ? 'var(--gold)' : '';
        fav.addEventListener('click', () => { favPresets.toggle(presetId); render(); });
        row.append(prevBtn, applyBtn, fav);
        if (custom) {
          const del = el('button', { class: 'mini-btn danger', 'aria-label': t('presetDelete'), html: icon('trash', 14) });
          del.addEventListener('click', () => {
            customPresets.set(customPresets.get().filter(p => p.id !== presetId));
            render();
            toast(t('presetDelete'), 'success');
          });
          const exp = el('button', { class: 'mini-btn', 'aria-label': t('presetExport'), html: icon('download', 14) });
          exp.addEventListener('click', () => {
            const preset = customPresets.get().find(p => p.id === presetId);
            const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
            downloadBlob(blob, (preset.name || 'preset') + '.one-studio.json');
          });
          row.append(exp, del);
        }
        c.append(row);
        return c;
      }

      function render() {
        listWrap.innerHTML = '';
        const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px' });
        if (cur === 'presetCustom') {
          const customs = customPresets.get();
          if (!customs.length) grid.append(el('div', { class: 'empty-note', style: 'grid-column:1/-1', text: t('presetCustom') }));
          for (const p of customs) grid.append(card(p.name, 'star', p.chain, p.id, true));
        } else {
          for (const p of CHAIN_PRESETS.filter(x => x.group === cur)) {
            grid.append(card(t(p.id), p.icon, p.chain, p.id));
          }
        }
        listWrap.append(grid);

        // بەشی دڵخوازەکان
        const favs = [...CHAIN_PRESETS.filter(p => favPresets.get()[p.id]), ...customPresets.get().filter(p => favPresets.get()[p.id])];
        if (favs.length && cur !== 'presetCustom') {
          const fg = el('div', { style: 'margin-top:16px' });
          fg.append(el('h4', { style: 'font-size:13px;color:var(--gold2)', text: '★ ' + t('favorites') }));
          const fgrid = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px' });
          for (const p of favs) {
            const isCustom = !p.group;
            fgrid.append(card(isCustom ? p.name : t(p.id), p.icon || 'star', p.chain, p.id, isCustom));
          }
          fg.append(fgrid);
          listWrap.append(fg);
        }
      }

      // هێنان و هەناردن
      const foot = md.root.querySelector('.modal-foot');
      const saveBtn = el('button', { class: 'btn', html: `${icon('save', 14)} ${t('presetSave')}` });
      saveBtn.addEventListener('click', () => {
        const nameModal = modal({
          title: t('presetNewName'),
          body(b2, md2) {
            const inp = el('input', { class: 'input', placeholder: t('presetNewName'), maxlength: '50' });
            b2.append(inp);
            setTimeout(() => inp.focus(), 50);
            inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
            function save() {
              const name = inp.value.trim() || t('presetCustom');
              const presets = customPresets.get();
              presets.push({ id: uid(), name, chain: state.chain.map(c => ({ type: c.type, params: { ...c.params } })) });
              customPresets.set(presets);
              nameModal.close();
              cur = 'presetCustom';
              [...tabs.children].forEach((x, i) => x.classList.toggle('toggle-on', groups[i] === cur));
              render();
              toast(t('projectSaved'), 'success');
            }
            const ok = el('button', { class: 'btn primary', text: t('save'), onclick: save });
            md.root.querySelector('.modal-body').append();
            b2.append(ok);
          },
        });
      });
      const importBtn = el('button', { class: 'btn', html: `${icon('upload', 14)} ${t('presetImport')}` });
      importBtn.addEventListener('click', () => {
        const inp = el('input', { type: 'file', accept: '.json,application/json', class: 'sr-only' });
        inp.addEventListener('change', async () => {
          const f = inp.files[0];
          if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            if (!Array.isArray(data.chain) || typeof data.name !== 'string') throw new Error('bad');
            const presets = customPresets.get();
            presets.push({ id: uid(), name: data.name, chain: data.chain });
            customPresets.set(presets);
            toast(t('presetImported'), 'success');
            render();
          } catch {
            toast(t('presetBadFile'), 'error');
          }
        });
        inp.click();
      });
      foot.append(saveBtn, importBtn);

      render();
    },
  });
}

/* ================================================================
 * باشترکردنی خێرا
 * ============================================================== */
export function openQuickEnhance() {
  let goal = 'quran';
  let intensity = 1;
  const md = modal({
    title: t('qeTitle'),
    body(b, md) {
      b.append(el('p', { style: 'color:var(--tx1);font-size:13px', text: t('qeDesc') }));
      b.append(el('h4', { style: 'font-size:13px;color:var(--gold2);margin:8px 0', text: t('qeGoal') }));
      const goals = el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:9px;margin-bottom:14px' });
      const goalBtns = [];
      for (const g of QUICK_GOALS) {
        const gb = el('button', {
          class: 'btn small' + (g.id === goal ? ' toggle-on' : ''),
          style: 'flex-direction:column;height:auto;padding:12px 8px;gap:4px',
          html: `${icon(g.icon, 18)}<span style="font-weight:600">${t(g.label)}</span><span style="font-size:10.5px;color:var(--tx2);font-weight:400">${t(g.desc)}</span>`,
        });
        gb.addEventListener('click', () => {
          goal = g.id;
          goalBtns.forEach((x, i) => x.classList.toggle('toggle-on', QUICK_GOALS[i].id === goal));
        });
        goalBtns.push(gb);
        goals.append(gb);
      }
      b.append(goals);
      b.append(el('h4', { style: 'font-size:13px;color:var(--gold2);margin:8px 0', text: t('qeIntensity') }));
      const seg = el('div', { class: 'tp-ab', style: 'display:inline-flex' });
      const opts = [[0.7, 'intensitySoft'], [1, 'intensityMedium'], [1.4, 'intensityStrong']];
      const segBtns = [];
      for (const [v, k] of opts) {
        const sb = el('button', { class: v === intensity ? 'on' : '', text: t(k) });
        sb.addEventListener('click', () => {
          intensity = v;
          segBtns.forEach((x, i) => x.classList.toggle('on', opts[i][0] === intensity));
        });
        segBtns.push(sb);
        seg.append(sb);
      }
      b.append(seg);
    },
    actions: [
      el('button', {
        class: 'btn primary', html: `${icon('wand', 15)} ${t('qeBuild')}`,
        onclick: () => {
          if (!state.working) { toast(t('errNoFile'), 'warn'); return; }
          const chain = buildQuickChain(goal, intensity);
          replaceChain(chain, t('qeBuilt'));
          md.close();
          toast(t('qeBuilt'), 'success');
        },
      }),
      el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => md.close() }),
    ],
  });
}

/* ================================================================
 * ئۆنبۆردینگ و یارمەتی
 * ============================================================== */
export function openOnboarding(done) {
  const steps = [1, 2, 3, 4, 5, 6].map(i => ({ title: t('ob' + i), desc: t('ob' + i + 'd') }));
  let idx = 0;
  const md = modal({
    title: t('obWelcome'), closable: true,
    onClose() { ls.set('onboarding-seen', 1); done?.(); },
    body(b, md) {
      const iconWrap = el('div', {
        style: 'width:64px;height:64px;border-radius:18px;background:var(--gold-dim);color:var(--gold2);display:flex;align-items:center;justify-content:center;margin:0 auto 14px',
      });
      const titleEl = el('h3', { style: 'text-align:center;font-size:17px' });
      const descEl = el('p', { style: 'text-align:center;color:var(--tx1);font-size:13.5px' });
      const dots = el('div', { style: 'display:flex;gap:6px;justify-content:center;margin-top:18px' });
      const ICONS = ['upload', 'sliders', 'broom', 'layers', 'wave', 'download'];
      function render() {
        iconWrap.innerHTML = icon(ICONS[idx], 28);
        titleEl.textContent = steps[idx].title;
        descEl.textContent = steps[idx].desc;
        dots.innerHTML = '';
        steps.forEach((_, i) => dots.append(el('span', {
          style: `width:${i === idx ? '22px' : '8px'};height:8px;border-radius:99px;background:${i === idx ? 'var(--gold)' : 'var(--bg4)'};transition:all .2s`,
        })));
        counter.textContent = t('obStep') + ` <b class="num">${idx + 1} / ${steps.length}</b>`;
        prevBtn.disabled = idx === 0;
        nextBtn.innerHTML = idx === steps.length - 1
          ? `${icon('play', 14)} ${t('obFinish')}`
          : `${t('obNext')} ${icon('chevL', 14)}`;
      }
      const counter = el('span', { style: 'font-size:12px;color:var(--tx2)' });
      const prevBtn = el('button', { class: 'btn ghost', text: t('obPrev') });
      const nextBtn = el('button', { class: 'btn primary' });
      prevBtn.addEventListener('click', () => { idx = Math.max(0, idx - 1); render(); });
      nextBtn.addEventListener('click', () => {
        if (idx === steps.length - 1) { md.close(); return; }
        idx++; render();
      });
      b.append(iconWrap, titleEl, descEl, dots);
      const foot = md.root.querySelector('.modal-foot');
      foot.append(counter, el('span', { style: 'flex:1' }), prevBtn, nextBtn);
      render();
    },
  });
}

export function openShortcutsDialog() {
  const rows = [
    [['Space'], 'scPlay'],
    [['Ctrl', 'Z'], 'scUndo'],
    [['Ctrl', 'Shift', 'Z'], 'scRedo'],
    [['+'], 'scZoom'],
    [['-'], 'scZoom'],
    [['Delete'], 'scDelete'],
    [['S'], 'scSplit'],
    [['Ctrl', 'E'], 'scExport'],
    [['L'], 'scLoop'],
    [['B'], 'scCompare'],
    [['?'], 'scHelp'],
  ];
  modal({
    title: t('shortcuts'),
    body(b, md) {
      for (const [keys, key] of rows) {
        b.append(el('div', { class: 'shortcut-row' },
          el('span', { class: 'sc-keys', html: keys.map(k => `<kbd>${k}</kbd>`).join(' ') }),
          el('span', { text: t(key) }),
        ));
      }
    },
  });
}

export function openHistoryDialog() {
  modal({
    title: t('history'),
    body(b, md) {
      if (!state.historyLog.length) { b.append(el('div', { class: 'empty-note', text: t('historyEmpty') })); return; }
      for (const h of state.historyLog) {
        b.append(el('div', { class: 'shortcut-row' },
          el('span', { style: 'flex:1', text: h.text }),
          el('span', { class: 'num', style: 'font-size:11px;color:var(--tx2)', text: new Date(h.time).toLocaleTimeString('en-GB') }),
        ));
      }
    },
  });
}

export function openMarkersDialog() {
  modal({
    title: t('markers'),
    body(b, md) {
      if (!state.markers?.length) { b.append(el('div', { class: 'empty-note', text: t('noMarkers') })); return; }
      [...state.markers].sort((a, b2) => a - b2).forEach((m, i) => {
        const row = el('div', { class: 'proj-item' });
        row.innerHTML = `<span class="ti-ic" style="width:30px;height:30px;border-radius:8px;background:var(--bg3);color:var(--gold2);display:flex;align-items:center;justify-content:center">${icon('layers', 14)}</span>
          <div class="pi-main" role="button" tabindex="0"><span class="num">${t('markers')} ${i + 1} — ${fmtTime(m)}</span></div>`;
        row.querySelector('.pi-main').addEventListener('click', () => { engine.seek(m); });
        const del = el('button', { class: 'mini-btn danger', 'aria-label': t('removeMarker'), html: icon('trash', 14) });
        del.addEventListener('click', () => {
          state.markers = state.markers.filter(x => x !== m);
          emit('markers');
          row.remove();
        });
        row.append(del);
        b.append(row);
      });
    },
  });
}

export function openRenameDialog(currentName, onRename) {
  const md = modal({
    title: t('rename'),
    body(b, md) {
      const inp = el('input', { class: 'input', value: currentName || '', maxlength: '60' });
      b.append(inp);
      setTimeout(() => { inp.focus(); inp.select(); }, 60);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      function ok() {
        const v = inp.value.trim();
        if (!v) return;
        md.close();
        onRename(v);
      }
      md.root.querySelector('.modal-foot').append(
        el('button', { class: 'btn primary', text: t('rename'), onclick: ok }),
        el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => md.close() }),
      );
    },
  });
}
