/* ===== ئامرازە هاوبەشەکانی وێب ===== */
import { t } from './l10n.js';
import { icon } from './ui/icons.js';
export { icon };

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const db2lin = (db) => Math.pow(10, db / 20);
export const lin2db = (v) => 20 * Math.log10(Math.max(v, 1e-9));
export const uid = () => 'id-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
export const debounce = (fn, ms) => {
  let h; const f = (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  f.cancel = () => clearTimeout(h);
  return f;
};
export const clampRemove = (arr, item) => { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); };

// ---- فۆرماتکردنی ژمارە و کات ----
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function fmtTime(sec, withTenth = true) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec * 10) % 10);
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withTenth ? `${base}.${d}` : base;
}
export const fmtHz = (v) => v >= 10000 ? nf1.format(v / 1000) + ' kHz' : v >= 1000 ? nf1.format(v / 1000) + ' kHz' : Math.round(v) + ' Hz';
export const fmtDb = (v) => (v > 0 ? '+' : '') + nf1.format(v) + ' dB';
export const fmtMs = (v) => v >= 1000 ? nf2.format(v / 1000) + ' s' : nf1.format(v) + ' ms';
export const fmtPct = (v) => Math.round(v) + '٪';
export const fmtX = (v) => nf2.format(v) + '×';
export const fmtBytes = (b) => {
  if (b > 1048576) return nf1.format(b / 1048576) + ' مێگابایت';
  if (b > 1024) return nf1.format(b / 1024) + ' کیلۆبایت';
  return b + ' بایت';
};
// ژمارە لە ناو دەقی RTL — بە ltr چوارچێوە
export const NUM = (s) => `<span class="num">${s}</span>`;

// ---- DOM ----
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}
export const $id = (id) => document.getElementById(id);
export const $q = (sel, root = document) => root.querySelector(sel);
export const $qa = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---- localStorage بچووک ----
export const ls = {
  get(k, def) { try { const v = localStorage.getItem('one-studio:' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
  set(k, v) { try { localStorage.setItem('one-studio:' + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem('one-studio:' + k); } catch {} },
};

// ---- تۆست ----
const TOAST_ICON = { success: 'check', error: 'alert', warn: 'alert', info: 'info' };
export function toast(msg, type = 'info', ms = 3800) {
  const root = $id('toast-root');
  const elT = el('div', { class: `toast ${type}`, role: 'status' });
  elT.innerHTML = `${icon(TOAST_ICON[type] || 'info', 17)}<div>${msg}</div>`;
  root.append(elT);
  setTimeout(() => { elT.classList.add('out'); setTimeout(() => elT.remove(), 260); }, ms);
  while (root.children.length > 4) root.firstChild.remove();
}

// ---- مۆداڵ ----
let openModals = [];
export function modal({ title, wide = false, body, actions = [], onClose, closable = true }) {
  const back = el('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true' });
  const m = el('div', { class: `modal${wide ? ' wide' : ''}` });
  const head = el('div', { class: 'modal-head' },
    el('h3', { text: title }),
    closable ? el('button', { class: 'modal-x', 'aria-label': t('close'), html: icon('x', 17), onclick: () => close() }) : null,
  );
  const bodyEl = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });
  m.append(head, bodyEl, foot);
  back.append(m);
  $id('overlay-root').append(back);

  function close() {
    if (!back.isConnected) return;
    back.remove();
    openModals = openModals.filter(x => x !== api);
    onClose && onClose();
  }
  const api = { close, root: m, body: bodyEl, setTitle: (s) => { head.querySelector('h3').textContent = s; } };
  if (typeof body === 'function') body(bodyEl, api); else if (body) bodyEl.append(body);
  for (const a of actions) foot.append(a);
  if (closable) back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  openModals.push(api);
  return api;
}
export const closeAllModals = () => { [...openModals].forEach(m => m.close()); };
export const hasOpenModal = () => openModals.length > 0;
export function confirmDlg(msg, onOk, okLabel) {
  const md = modal({
    title: t('confirm'),
    body(b) { b.append(el('p', { text: msg, style: 'margin:4px 0 8px' })); },
    actions: [
      el('button', { class: 'btn danger', text: okLabel || t('confirm'), onclick: () => { md.close(); onOk(); } }),
      el('button', { class: 'btn ghost', text: t('cancel'), onclick: () => md.close() }),
    ],
  });
  return md;
}

// ---- ئۆڤەرلەی پڕۆسەکردن ----
export function showProgress({ text, cancelable = false, onCancel }) {
  const back = el('div', { class: 'modal-back', style: 'z-index:300' });
  const card = el('div', {
    class: 'card', style: 'width:min(420px,92vw);display:flex;flex-direction:column;gap:14px;padding:26px',
    role: 'alertdialog', 'aria-label': t('processing'),
  });
  const txt = el('div', { style: 'display:flex;align-items:center;gap:11px;font-family:var(--font-h);font-size:14px' });
  txt.append(el('div', { class: 'spinner' }), el('span', { text }));
  const track = el('div', { class: 'progress-track' });
  const fill = el('div', { class: 'progress-fill' });
  track.append(fill);
  const pct = el('div', { class: 'num', style: 'font-size:12px;color:var(--tx2);text-align:center', text: '0٪' });
  card.append(txt, track, pct);
  let token = { cancelled: false };
  if (cancelable) {
    card.append(el('button', {
      class: 'btn ghost small', style: 'align-self:center', text: t('cancel'),
      onclick: () => { token.cancelled = true; onCancel && onCancel(); },
    }));
  }
  back.append(card);
  $id('overlay-root').append(back);
  return {
    token,
    update(p, newText) {
      if (newText) txt.querySelector('span').textContent = newText;
      const pp = clamp(Math.round(p * 100), 0, 100);
      fill.style.width = pp + '%';
      pct.textContent = pp + '٪';
    },
    indeterminate() { fill.style.width = '40%'; },
    close() { back.remove(); },
  };
}

// ---- لوپێکی rAF ی هاوبەش ----
const rafSubs = new Set();
export function onFrame(fn) { rafSubs.add(fn); return () => rafSubs.delete(fn); }
(function loop() {
  requestAnimationFrame(loop);
  for (const fn of rafSubs) { try { fn(); } catch (e) { console.error(e); } }
})();

// ---- ئاماژەی هەڵوەشاندنەوە ----
export const cancelToken = () => ({ cancelled: false });
