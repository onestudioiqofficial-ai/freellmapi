/* ===== ڕێکخستنی دەنگ (Audio Rack) — زنجیرەی ئەفێکتەکان ===== */
import { REGISTRY } from '../effects/registry.js';
import { instanceLabel, moveInstance } from '../effects/chain.js';
import { state, emit, pushUndo } from '../state.js';
import { el, icon } from '../utils.js';
import { t } from '../l10n.js';
import { engine } from '../audio/engine.js';

/* کورتەی پارامیتەرەکان بۆ نیشاندان لەژێر ناو */
function summarize(inst) {
  const def = REGISTRY[inst.type];
  if (!def) return '';
  const parts = [];
  for (const pd of def.params) {
    if (!pd.basic || parts.length >= 2) continue;
    const v = inst.params[pd.id];
    if (v === undefined || v === pd.def) continue;
    const unit = { uHz: 'Hz', uDb: 'dB', uMs: 'ms', uPct: '٪', uSec: 's', '': '' }[pd.unit] ?? '';
    const num = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    parts.push(`${t(pd.label)} <span class="num">${num}${unit ? ' ' + unit : ''}</span>`);
  }
  if (!parts.length) return t('p.on') + ' — ' + t('settings');
  return parts.join(' · ');
}

export function createRack() {
  const root = el('aside', { class: 'side right', id: 'rack-panel' });
  const head = el('div', { class: 'side-head' });
  head.innerHTML = `${icon('layers', 16)} <span>${t('rack')}</span>`;
  const count = el('span', { class: 'count' });
  head.append(count);
  const body = el('div', { class: 'side-body' });
  const list = el('div', { class: 'chain-list' });
  body.append(list);
  root.append(head, body);

  function render() {
    list.innerHTML = '';
    count.textContent = state.chain.length + ' ' + t('chainCount');
    if (!state.chain.length) {
      list.append(el('div', { class: 'chain-empty', html: `${icon('plus', 18)}<br>${t('addEffectHint')}` }));
      return;
    }
    state.chain.forEach((inst, idx) => {
      const def = REGISTRY[inst.type];
      const item = el('div', {
        class: 'chain-item' + (state.selFx === inst.uid ? ' sel' : '') + (inst.enabled ? '' : ' off'),
        dataset: { uid: inst.uid },
      });
      const row = el('div', { class: 'chain-row' });
      row.append(el('span', { class: 'ci-num', text: String(idx + 1) }));
      row.append(el('span', { class: 'ci-ic', html: icon(def.icon, 17) }));

      const main = el('div', { class: 'ci-main', role: 'button', tabindex: '0', 'aria-label': t('settings') });
      main.innerHTML = `<span class="ci-name">${instanceLabel(inst)}${inst.bypassed ? ` <span class="badge gray">${t('hBypass')}</span>` : ''}</span>
        <span class="ci-sub">${summarize(inst)}</span>`;
      main.addEventListener('click', () => { state.selFx = inst.uid; emit('fx-select'); render(); });
      row.append(main);

      // دوگمەکان
      const btns = el('div', { class: 'ci-btns' });
      const bypass = el('button', {
        class: 'mini-btn' + (inst.bypassed ? ' danger' : ''), title: t('compare'), 'aria-label': t('compare'),
        html: icon('wave', 14),
      });
      bypass.addEventListener('click', () => {
        const inst_ = inst;
        const old = inst_.bypassed;
        inst_.bypassed = !old;
        pushUndo({
          log: instanceLabel(inst_) + ' — ' + t('hBypass'),
          undo() { inst_.bypassed = old; engine.bypassChanged(inst_); emit('chain'); },
          redo() { inst_.bypassed = !old; engine.bypassChanged(inst_); emit('chain'); },
        });
        engine.bypassChanged(inst_);
        emit('chain');
      });
      const onoff = el('label', { class: 'switch', title: t('p.on') });
      const sw = el('input', { type: 'checkbox', 'aria-label': t('p.on') });
      sw.checked = !!inst.enabled;
      sw.addEventListener('change', () => {
        const old = inst.enabled;
        inst.enabled = sw.checked;
        pushUndo({
          log: instanceLabel(inst) + ' — ' + t('hEnable'),
          undo() { inst.enabled = old; emit('chain'); },
          redo() { inst.enabled = sw.checked; emit('chain'); },
        });
        emit('chain');
      });
      onoff.append(sw, el('span', { class: 'track' }));
      btns.append(bypass, onoff);
      row.append(btns);

      // ڕیزبەندی و سڕینەوە
      const acts = el('div', { class: 'ci-acts' });
      const up = el('button', { class: 'mini-btn', 'aria-label': '↑', html: icon('up', 13) });
      up.addEventListener('click', () => moveCmd(inst, -1));
      const down = el('button', { class: 'mini-btn', 'aria-label': '↓', html: icon('down', 13) });
      down.addEventListener('click', () => moveCmd(inst, +1));
      const del = el('button', { class: 'mini-btn danger', 'aria-label': t('delete'), html: icon('x', 13) });
      del.addEventListener('click', () => {
        const i = state.chain.indexOf(inst);
        state.chain.splice(i, 1);
        if (state.selFx === inst.uid) state.selFx = null;
        pushUndo({
          log: t('hRemoveFx') + ': ' + instanceLabel(inst),
          undo() { state.chain.splice(i, 0, inst); emit('chain'); },
          redo() { state.chain = state.chain.filter(c => c !== inst); emit('chain'); },
        }, t('hRemoveFx') + ': ' + instanceLabel(inst));
        emit('chain');
      });
      acts.append(up, down, del);
      row.append(acts);
      item.append(row);

      // مێتەری GR بۆ ئەوانەی پشتگیری دەکەن
      const w = engine.graph?.wrappers.find(x => x.inst?.uid === inst.uid);
      if (w?.impl?.gr) {
        const gr = el('div', { class: 'gr-mini' });
        const grFill = el('i');
        gr.append(grFill);
        item.append(gr);
        item._grFill = grFill;
      }
      list.append(item);
    });
  }

  function moveCmd(inst, dir) {
    const old = state.chain.map(c => c);
    if (!moveInstance(state.chain, inst.uid, dir)) return;
    pushUndo({
      log: t('hReorder'),
      undo() { state.chain = old; emit('chain'); },
      redo() { moveInstance(state.chain, inst.uid, dir); emit('chain'); },
    }, t('hReorder'));
    emit('chain');
  }

  function tickMeters() {
    if (!engine.graph) return;
    for (const item of list.children) {
      if (!item._grFill) continue;
      const w = engine.graph.wrappers.find(x => x.inst?.uid === item.dataset.uid);
      const gr = w?.impl?.gr?.() || 0;
      const v = Math.min(24, Math.abs(gr));
      item._grFill.style.width = (v / 24 * 100) + '%';
    }
  }

  render();
  return { root, render, tickMeters };
}
