/* ===== تەپە (Knob) — کۆنترۆڵی پیشەیی بە ماوس، تەچ و کیبۆرد ===== */
import { el, clamp } from '../utils.js';
import { t } from '../l10n.js';

export function makeKnob({
  label, value, min, max, step = 0.01, unit = '', curve = 'lin',
  size = 46, fmt = null, basic = true,
  onInput, onCommit, ariaLabel,
}) {
  const toPos = (v) => curve === 'log' && min > 0
    ? Math.log(v / min) / Math.log(max / min)
    : (v - min) / (max - min);
  const fromPos = (p) => {
    const pp = clamp(p, 0, 1);
    let v;
    if (curve === 'log' && min > 0) v = min * Math.pow(max / min, pp);
    else v = min + (max - min) * pp;
    v = Math.round(v / step) * step;
    return clamp(v, min, max);
  };
  const fmtVal = (v) => {
    if (fmt) return fmt(v);
    const n = Math.abs(v) >= 100 ? Math.round(v) : Math.abs(v) >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100;
    return String(n) + (unit ? ' ' : '');
  };

  let current = clamp(value, min, max);
  let dragging = false, startY = 0, startPos = 0;

  const UNIT_LABEL = { uHz: 'Hz', uKhz: 'kHz', uDb: 'dB', uMs: 'ms', uSec: 's', uPct: '٪', '': '' }[unit] ?? unit;
  const disp = (v) => fmtVal(v) + (fmt ? '' : ' ' + UNIT_LABEL);

  const arc = el('div', { class: 'knob-arc' });
  const body = el('div', {
    class: 'knob-body', role: 'slider', tabindex: '0',
    'aria-valuemin': String(min), 'aria-valuemax': String(max), 'aria-valuenow': String(current),
    'aria-label': ariaLabel || (label ? t(label) : 'knob'),
    'aria-orientation': 'vertical',
  });
  const valEl = el('span', { class: 'num knob-val' });
  const labEl = el('span', { class: 'knob-label', text: label ? t(label) : '' });

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.classList.add('knob-svg');
  const R = 16, CX = 20, CY = 20;
  const A0 = 135, A1 = 405; // پلە
  const polar = (ang, r) => [CX + r * Math.cos(ang * Math.PI / 180), CY + r * Math.sin(ang * Math.PI / 180)];
  const arcPath = (a0, a1, r) => {
    const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
    const large = (a1 - a0) > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
  };
  const track = document.createElementNS(svgNs, 'path');
  track.setAttribute('d', arcPath(A0, A1, R));
  track.setAttribute('class', 'knob-track');
  const prog = document.createElementNS(svgNs, 'path');
  prog.setAttribute('class', 'knob-prog');
  const ptr = document.createElementNS(svgNs, 'circle');
  ptr.setAttribute('r', '3.2');
  ptr.setAttribute('class', 'knob-ptr');
  const cap = document.createElementNS(svgNs, 'line');
  cap.setAttribute('class', 'knob-cap');
  svg.append(track, prog, ptr, cap);
  arc.append(svg);

  function render() {
    const p = toPos(current);
    const ang = A0 + (A1 - A0) * p;
    prog.setAttribute('d', arcPath(A0, Math.max(A0 + 0.5, ang), R));
    const [px, py] = polar(ang, R);
    ptr.setAttribute('cx', px); ptr.setAttribute('cy', py);
    const [c0x, c0y] = polar(ang, 4), [c1x, c1y] = polar(ang, R - 3);
    cap.setAttribute('x1', c0x); cap.setAttribute('y1', c0y);
    cap.setAttribute('x2', c1x); cap.setAttribute('y2', c1y);
    body.setAttribute('aria-valuenow', String(Math.round(current * 1000) / 1000));
    body.setAttribute('aria-valuetext', disp(current));
    valEl.textContent = disp(current);
  }

  const set = (v, fire = true) => {
    current = clamp(v, min, max);
    render();
    if (fire) onInput?.(current);
  };

  body.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { body.setPointerCapture(e.pointerId); } catch {}
    dragging = true;
    startY = e.clientY;
    startPos = toPos(current);
    body.classList.add('active');
  });
  body.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY; // سەرەوە = زیادکردن
    const speed = e.shiftKey ? 0.0012 : 0.005;
    set(fromPos(startPos + dy * speed));
  });
  const up = () => {
    if (!dragging) return;
    dragging = false;
    body.classList.remove('active');
    onCommit?.(current);
  };
  body.addEventListener('pointerup', up);
  body.addEventListener('pointercancel', up);
  body.addEventListener('dblclick', () => { set(value); onCommit?.(value); }); // گەڕاندنەوە بۆ بنەڕەت
  body.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = toPos(current) + (e.deltaY < 0 ? 0.04 : -0.04);
    set(fromPos(p));
    clearTimeout(body._wt);
    body._wt = setTimeout(() => onCommit?.(current), 350);
  }, { passive: false });
  body.addEventListener('keydown', (e) => {
    let handled = true;
    const big = (max - min) / 20;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(current + (e.shiftKey ? big / 5 : step * 5));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(current - (e.shiftKey ? big / 5 : step * 5));
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else handled = false;
    if (handled) { e.preventDefault(); onCommit?.(current); }
  });

  render();
  const root = el('div', { class: 'ctl' + (basic ? ' basic' : ' adv') });
  const wrap = el('div', { class: 'knob-wrap' });
  wrap.append(body, arc);
  root.append(wrap, valEl, labEl);
  root.classList.add('knob-ctl');
  return { root, set, get: () => current };
}
