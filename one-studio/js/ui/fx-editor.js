/* ===== دەستکاریکەری ئەفێکت — کۆنترۆڵەکان + EQ تایبەت ===== */
import { REGISTRY } from '../effects/registry.js';
import { instanceLabel } from '../effects/chain.js';
import { state, emit, pushUndo, busOn } from '../state.js';
import { engine } from '../audio/engine.js';
import { el, icon, onFrame } from '../utils.js';
import { t } from '../l10n.js';
import { makeKnob } from './knob.js';
import { GRMeter } from './meters.js';
import { runOp } from '../workers/client.js';
import { showProgress } from '../utils.js';

export function createFxEditor() {
  const root = el('section', { class: 'fx-editor hidden', id: 'fx-editor' });

  let cleanup = null;
  function close() { state.selFx = null; render(); }

  function render() {
    if (cleanup) { cleanup(); cleanup = null; }
    root.innerHTML = '';
    const inst = state.chain.find(c => c.uid === state.selFx);
    if (!inst) { root.classList.add('hidden'); return; }
    const def = REGISTRY[inst.type];
    root.classList.remove('hidden');

    // سەرەوە
    const head = el('div', { class: 'fxe-head' });
    head.innerHTML = `
      <span class="ic">${icon(def.icon, 17)}</span>
      <div style="flex:1;min-width:0">
        <b>${instanceLabel(inst)}</b>
        <span class="sub">${t(def.desc)}</span>
      </div>`;
    if (inst.bypassed) head.append(el('span', { class: 'badge amber', text: t('hBypass') }));
    const w = engine.graph?.wrappers.find(x => x.inst?.uid === inst.uid);
    if (w?.impl?.fallback) head.append(el('span', { class: 'badge gray', title: t('errWorker'), text: t('errWorker') }));
    if (def.presets?.length) {
      const sel = el('select', { class: 'input', style: 'max-width:190px', 'aria-label': t('presets') });
      sel.append(el('option', { value: '', text: '— ' + t('presets') + ' —' }));
      for (const pr of def.presets) sel.append(el('option', { value: pr.id, text: t(pr.id) }));
      sel.addEventListener('change', () => {
        const pr = def.presets.find(p => p.id === sel.value);
        if (!pr) return;
        const old = { ...inst.params };
        Object.assign(inst.params, pr.v);
        engine.chainParamChanged(inst);
        pushUndo({
          log: instanceLabel(inst) + ' — ' + t(pr.id),
          undo() { Object.assign(inst.params, old); engine.chainParamChanged(inst); emit('fx-refresh'); },
          redo() { Object.assign(inst.params, pr.v); engine.chainParamChanged(inst); emit('fx-refresh'); },
        }, instanceLabel(inst) + ' — ' + t(pr.id));
        emit('fx-refresh');
        render();
      });
      head.append(sel);
    }
    head.append(el('button', { class: 'modal-x', 'aria-label': t('close'), html: icon('x', 15), onclick: close }));
    root.append(head);

    const bodyEl = el('div', { class: 'fxe-body' });
    root.append(bodyEl);

    // تێبینی ئاگاداری
    if (def.note) {
      bodyEl.append(el('div', { class: 'fx-note' + (def.noteType === 'info' ? ' info' : ''), html: `${icon('alert', 15)}<span>${t(def.note)}</span>` }));
    }

    if (def.special === 'eq') renderEq(bodyEl, inst, def);
    else if (def.special === 'autogain') renderAutoGain(bodyEl, inst, def);
    else renderGeneric(bodyEl, inst, def);

    // مێتەری GR
    if (w?.impl?.gr) {
      const grWrap = el('div', { style: 'margin-top:14px;display:flex;align-items:center;gap:10px' });
      grWrap.append(el('span', { style: 'font-size:11.5px;color:var(--tx1);font-family:var(--font-h)', text: t('meterGR') }));
      const grEl = el('div', { class: 'gr-mini', style: 'flex:1;height:6px;margin:0' });
      const grm = new GRMeter(grEl);
      grWrap.append(grEl);
      bodyEl.append(grWrap);
      const off = onFrame(() => grm.update(w.impl.gr()));
      cleanup = () => { off(); };
    }
  }

  /* ---- کۆنترۆڵی گشتی ---- */
  function renderGeneric(bodyEl, inst, def) {
    const grid = el('div', { class: 'fx-controls' });
    for (const pd of def.params) {
      if (state.mode === 'simple' && !pd.basic) continue;
      grid.append(paramControl(inst, def, pd));
    }
    bodyEl.append(grid);
  }

  function paramControl(inst, def, pd) {
    const wrap = el('div', { class: 'ctl' + (pd.type === 'select' ? ' wide' : '') });
    if (pd.type === 'knob') {
      const k = makeKnob({
        label: pd.label, value: inst.params[pd.id], min: pd.min, max: pd.max,
        step: pd.step || 0.01, unit: pd.unit, curve: pd.curve, fmt: pd.fmt, basic: pd.basic,
        onInput: (v) => {
          inst.params[pd.id] = v;
          engine.chainParamChanged(inst);
        },
        onCommit: (v) => commitParam(inst, def, pd, v),
      });
      return k.root;
    }
    if (pd.type === 'select') {
      wrap.innerHTML = `<span class="ctl-label">${t(pd.label)}</span>`;
      const sel = el('select', { class: 'input', 'aria-label': t(pd.label) });
      for (const o of pd.options) {
        const opt = el('option', { value: String(o.v) });
        opt.textContent = o.label !== undefined ? o.label : t(o.k);
        sel.append(opt);
      }
      sel.value = String(inst.params[pd.id]);
      sel.addEventListener('change', () => {
        const raw = typeof pd.options[0].v === 'number' ? Number(sel.value) : sel.value;
        commitParam(inst, def, pd, raw, true);
      });
      wrap.append(sel);
      return wrap;
    }
    if (pd.type === 'toggle') {
      const lab = el('label', { class: 'check-row' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = !!inst.params[pd.id];
      cb.addEventListener('change', () => commitParam(inst, def, pd, cb.checked ? 1 : 0, true));
      lab.append(cb, el('span', { text: t(pd.label) }));
      wrap.append(lab);
      return wrap;
    }
    return wrap;
  }

  function commitParam(inst, def, pd, v, refresh = false) {
    const old = inst.params[pd.id];
    inst.params[pd.id] = v;
    engine.chainParamChanged(inst);
    pushUndo({
      log: instanceLabel(inst) + ' — ' + t(pd.label) + ' ' + t('hParam'),
      undo() { inst.params[pd.id] = old; engine.chainParamChanged(inst); emit('fx-refresh'); },
      redo() { inst.params[pd.id] = v; engine.chainParamChanged(inst); emit('fx-refresh'); },
    });
    if (refresh) { emit('chain'); render(); }
  }

  /* ---- هاوسەنگکردنی خۆکار ---- */
  function renderAutoGain(bodyEl, inst, def) {
    const grid = el('div', { class: 'fx-controls' });
    for (const pd of def.params) {
      if (state.mode === 'simple' && !pd.basic) continue;
      grid.append(paramControl(inst, def, pd));
    }
    bodyEl.append(grid);
    const row = el('div', { style: 'margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap' });
    const btn = el('button', { class: 'btn small', html: `${icon('autogain', 14)} پێوانە و ڕێکخستنی خۆکار` });
    const result = el('span', { style: 'font-size:12px;color:var(--tx1)' });
    btn.addEventListener('click', async () => {
      const pr = showProgress({ text: t('procMeasuring') });
      try {
        const channels = engine.channelData(state.working);
        const res = await runOp('loudness', { channels, sampleRate: state.working.sampleRate });
        pr.close();
        if (!isFinite(res.lufs)) { result.textContent = t('measured') + ': —'; return; }
        const makeup = Math.max(-15, Math.min(15, inst.params.target - res.lufs));
        inst.params.makeup = Math.round(makeup * 10) / 10;
        engine.chainParamChanged(inst);
        result.innerHTML = `${t('measuredLufs')}: <b class="num">${res.lufs.toFixed(1)}</b> → ${t('p.makeup')}: <b class="num">${inst.params.makeup.toFixed(1)} dB</b>`;
        emit('fx-refresh'); render();
      } catch (e) {
        pr.close();
        result.textContent = t('errProcess');
      }
    });
    row.append(btn, result);
    bodyEl.append(row);
  }

  /* ---- EQ ـی پیشەیی ---- */
  function renderEq(bodyEl, inst, def) {
    const wrap = el('div', { class: 'eq-editor' });
    const canvasWrap = el('div', { class: 'eq-canvas-wrap' });
    const cv = el('canvas', { 'aria-label': t('tEq') });
    canvasWrap.append(cv);
    const side = el('div', { class: 'eq-bands' });

    const BANDS = [
      { id: 'hp', name: 'HP', freq: 'hpFreq', gain: null, q: null, on: 'hpOn', minF: 20, maxF: 500 },
      { id: 'ls', name: 'LS', freq: 'lsFreq', gain: 'lsGain', q: null, minF: 40, maxF: 400 },
      { id: 'b1', name: 'B1', freq: 'b1Freq', gain: 'b1Gain', q: 'b1Q', minF: 80, maxF: 1200 },
      { id: 'b2', name: 'B2', freq: 'b2Freq', gain: 'b2Gain', q: 'b2Q', minF: 300, maxF: 3000 },
      { id: 'b3', name: 'B3', freq: 'b3Freq', gain: 'b3Gain', q: 'b3Q', minF: 1000, maxF: 8000 },
      { id: 'b4', name: 'B4', freq: 'b4Freq', gain: 'b4Gain', q: 'b4Q', minF: 2500, maxF: 14000 },
      { id: 'hs', name: 'HS', freq: 'hsFreq', gain: 'hsGain', q: null, minF: 2000, maxF: 16000 },
      { id: 'lp', name: 'LP', freq: 'lpFreq', gain: null, q: null, on: 'lpOn', minF: 1000, maxF: 20000 },
    ];
    let selBand = 'b3';

    function bandRow(b) {
      const on = b.on ? !!inst.params[b.on] : true;
      const row = el('div', {
        class: 'eq-band' + (selBand === b.id ? ' sel' : '') + (on ? '' : ' off'),
        role: 'button', tabindex: '0',
      });
      row.innerHTML = `
        <span class="eb-name">${b.name}</span>
        ${b.on !== undefined ? `<span class="badge ${on ? 'green' : 'gray'}" style="font-size:9.5px">${on ? t('p.on') : t('p.off')}</span>` : ''}
        <span class="eb-freq num">${fmtHzShort(inst.params[b.freq])}</span>
        ${b.gain ? `<span class="eb-gain num">${(inst.params[b.gain] > 0 ? '+' : '') + inst.params[b.gain].toFixed(1)} dB</span>` : '<span class="eb-gain"></span>'}`;
      row.addEventListener('click', () => { selBand = b.id; renderBands(); drawStatic(); });
      return row;
    }
    function renderBands() {
      side.innerHTML = '';
      for (const b of BANDS) side.append(bandRow(b));
      // کۆنترۆڵی باندی هەڵبژێردراو
      const b = BANDS.find(x => x.id === selBand);
      if (!b) return;
      const controls = el('div', { class: 'fx-controls', style: 'margin-top:10px' });
      controls.append(makeKnob({
        label: 'p.freq', value: inst.params[b.freq], min: b.minF, max: b.maxF, curve: 'log', unit: 'uHz',
        onInput: (v) => { inst.params[b.freq] = v; engine.chainParamChanged(inst); },
        onCommit: (v) => { commitParam(inst, def, { id: b.freq, label: 'p.freq' }, v); renderBands(); },
      }).root);
      if (b.gain) controls.append(makeKnob({
        label: 'p.gain', value: inst.params[b.gain], min: -15, max: 15, unit: 'uDb', step: 0.1,
        onInput: (v) => { inst.params[b.gain] = v; engine.chainParamChanged(inst); },
        onCommit: (v) => { commitParam(inst, def, { id: b.gain, label: 'p.gain' }, v); renderBands(); },
      }).root);
      if (b.q) controls.append(makeKnob({
        label: 'p.q', value: inst.params[b.q], min: 0.3, max: 8, curve: 'log', step: 0.05,
        onInput: (v) => { inst.params[b.q] = v; engine.chainParamChanged(inst); },
        onCommit: (v) => { commitParam(inst, def, { id: b.q, label: 'p.q' }, v); },
      }).root);
      if (b.on) {
        const tgl = el('label', { class: 'check-row' });
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!inst.params[b.on];
        cb.addEventListener('change', () => {
          commitParam(inst, def, { id: b.on, label: b.id === 'hp' ? 'p.hpOn' : 'p.lpOn' }, cb.checked ? 1 : 0, true);
        });
        tgl.append(cb, el('span', { text: b.id === 'hp' ? t('p.hpOn') : t('p.lpOn') }));
        controls.append(tgl);
      }
      side.append(controls);
    }

    const F_MIN = 20, F_MAX = 20000;
    const xOf = (f, W) => Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN) * W;
    const fOf = (x, W) => F_MIN * Math.pow(F_MAX / F_MIN, x / W);
    const G_MAX = 16;
    const yOf = (g, H) => H / 2 - (g / G_MAX) * (H / 2 - 12);

    function responseCurve(W, H, nodes) {
      const n = Math.max(80, Math.floor(W / 4));
      const freqs = new Float32Array(n), mag = new Float32Array(n), phase = new Float32Array(n);
      for (let i = 0; i < n; i++) freqs[i] = fOf(i / (n - 1) * W, W);
      let totalDb = new Float32Array(n);
      for (const node of nodes) {
        try {
          node.getFrequencyResponse(freqs, mag, phase);
          for (let i = 0; i < n; i++) totalDb[i] += 20 * Math.log10(Math.max(mag[i], 1e-6));
        } catch {}
      }
      return { freqs, totalDb, n };
    }

    function drawStatic() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = cv.clientWidth || 500, H = cv.clientHeight || 230;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      const c = cv.getContext('2d');
      c.save(); c.scale(dpr, dpr);
      c.fillStyle = '#070a10';
      c.fillRect(0, 0, W, H);
      // تۆڕی فرێکوێنسی
      c.font = '9.5px "Noto Sans Arabic"';
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        const x = xOf(f, W);
        c.strokeStyle = 'rgba(255,255,255,.06)';
        c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke();
        c.fillStyle = 'rgba(108,127,153,.7)';
        c.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x + 3, 11);
      }
      for (const g of [-12, -6, 0, 6, 12]) {
        const y = yOf(g, H);
        c.strokeStyle = g === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.055)';
        c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
        c.fillStyle = 'rgba(108,127,153,.6)';
        c.fillText((g > 0 ? '+' : '') + g, 4, y - 3);
      }
      // سپێکترەمی زیندوو
      const bins = engine.spectrumBins();
      if (bins && engine.specA) {
        if (!drawStatic.arr || drawStatic.arr.length !== bins) drawStatic.arr = new Float32Array(bins);
        engine.spectrum(drawStatic.arr);
        c.fillStyle = 'rgba(61,214,245,.13)';
        const bars = Math.floor(W / 3);
        for (let i = 0; i < bars; i++) {
          const f0 = F_MIN * Math.pow(F_MAX / F_MIN, i / bars);
          const f1 = F_MIN * Math.pow(F_MAX / F_MIN, (i + 1) / bars);
          const b0 = Math.floor(f0 / (engine.sampleRate() / 2) * bins);
          const b1 = Math.max(b0 + 1, Math.floor(f1 / (engine.sampleRate() / 2) * bins));
          let pk = -140;
          for (let b = b0; b < Math.min(b1, bins); b++) if (drawStatic.arr[b] > pk) pk = drawStatic.arr[b];
          const frac = Math.max(0, Math.min(1, (pk + 90) / 90));
          const bh = frac * (H - 8);
          c.fillRect(i * (W / bars), H - bh, Math.max(1.5, W / bars - 1), bh);
        }
      }
      // خاڵی کێشەی EQ
      const w = engine.graph?.wrappers.find(x => x.inst?.uid === inst.uid);
      const nodes = w?.impl?.nodes || [];
      if (nodes.length) {
        const { totalDb, n } = responseCurve(W, H, nodes);
        c.strokeStyle = '#f0b429';
        c.lineWidth = 2.2;
        c.beginPath();
        for (let i = 0; i < n; i++) {
          const x = i / (n - 1) * W;
          const y = yOf(Math.max(-G_MAX, Math.min(G_MAX, totalDb[i])), H);
          i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
        }
        c.stroke();
        c.strokeStyle = 'rgba(240,180,41,.25)';
        c.lineWidth = 6;
        c.stroke();
      }
      // خاڵە جوڵاوەکان
      c.font = '9px "Noto Kufi Arabic"';
      for (const b of BANDS) {
        if (b.on && !inst.params[b.on]) continue;
        const x = xOf(inst.params[b.freq], W);
        const y = b.gain ? yOf(inst.params[b.gain], H) : H / 2;
        c.fillStyle = selBand === b.id ? '#ffd166' : 'rgba(240,180,41,.75)';
        c.beginPath(); c.arc(x, y, selBand === b.id ? 6.5 : 5, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#221600';
        c.fillText(b.name, x - 6, y + 3);
      }
      c.restore();
    }

    // کێشان بۆ گۆڕینی فرێکوێنسی/گەین
    let draggingBand = null;
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // نزیکترین خاڵ
      let best = null, bd = 20;
      for (const b of BANDS) {
        if (b.on && !inst.params[b.on]) continue;
        const bx = xOf(inst.params[b.freq], r.width);
        const by = b.gain ? yOf(inst.params[b.gain], r.height) : r.height / 2;
        const d = Math.hypot(bx - x, by - y);
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        selBand = best.id;
        draggingBand = best;
        try { cv.setPointerCapture(e.pointerId); } catch {}
        renderBands();
      }
      drawStatic();
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (draggingBand) {
        const b = draggingBand;
        const f = Math.max(b.minF, Math.min(b.maxF, fOf(x, r.width)));
        inst.params[b.freq] = f;
        if (b.gain) inst.params[b.gain] = Math.max(-15, Math.min(15, (r.height / 2 - y) / (r.height / 2 - 12) * G_MAX));
        engine.chainParamChanged(inst);
        drawStatic();
        if (!draggingBand._throttled) {
          draggingBand._throttled = true;
          setTimeout(() => { draggingBand && (draggingBand._throttled = false); renderBands(); }, 120);
        }
      } else {
        cv.style.cursor = 'grab';
      }
    });
    const endDrag = () => {
      if (draggingBand) {
        commitEqBand(draggingBand);
        draggingBand = null;
        renderBands();
      }
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);

    function commitEqBand(b) {
      const old = { freq: inst.params[b.freq], gain: b.gain ? inst.params[b.gain] : 0 };
      pushUndo({
        log: 'EQ — ' + b.name,
        undo() { inst.params[b.freq] = old.freq; if (b.gain) inst.params[b.gain] = old.gain; engine.chainParamChanged(inst); emit('fx-refresh'); },
        redo() { /* ئێستا بەکارهێنەر گەیشتووەتە ئەم بەهایە */ },
      }, 'EQ — ' + b.name);
    }

    function fmtHzShort(v) {
      return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + '';
    }

    wrap.append(canvasWrap, side);
    bodyEl.append(wrap);
    renderBands();
    drawStatic();
    const ro = new ResizeObserver(() => drawStatic());
    ro.observe(cv);
    const off = onFrame(() => {
      if (engine.isPlaying || engine.specA) drawStatic();
    });
    const oldCleanup = cleanup;
    cleanup = () => { ro.disconnect(); off(); oldCleanup?.(); };
  }

  busOn('fx-refresh', render);
  busOn('chain', render);
  busOn('mode', render);
  busOn('fx-select', render);

  render();
  return { root, render };
}
