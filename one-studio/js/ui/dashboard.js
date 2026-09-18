/* ===== داشبۆرد — پڕۆژەکان، کاری خێرا و ئامرازەکان ===== */
import { t } from '../l10n.js';
import { el, icon, fmtBytes, confirmDlg, toast, showProgress } from '../utils.js';
import { TOOLS } from '../effects/registry.js';
import { CHAIN_PRESETS, QUICK_GOALS } from '../effects/presets.js';
import { Projects } from '../projects/store.js';
import { state, emit, resetSession } from '../state.js';
import { openQuickEnhance } from './dialogs.js';

function timeAgo(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'ئێستا';
  if (m < 60) return `${m} خولەک لەمەوبەر`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} کاتژمێر لەمەوبەر`;
  const dd = Math.floor(h / 24);
  return `${dd} ڕۆژ لەمەوبەر`;
}

export function renderDashboard(root) {
  const wrap = el('div', { class: 'dash' });
  const nav = el('nav', { class: 'nav' });
  nav.innerHTML = `
    <div class="nav-in">
      <div class="brand" data-go="landing" role="button" tabindex="0">
        <div class="mark">١</div>
        <div class="name">وان ستۆدیۆ<small>ستۆدیۆی دەنگی وێب</small></div>
      </div>
      <div class="nav-links">
        <a data-go="landing">${t('back')}</a>
        <button class="btn primary" data-go="studio">${icon('play', 15)} ${t('navStudio')}</button>
      </div>
    </div>`;
  wrap.append(nav);

  const head = el('div', { class: 'dash-head' });
  head.innerHTML = `
    <div style="flex:1">
      <h1>${t('dashHello')}</h1>
      <div class="sub">${t('dashSub')}</div>
    </div>`;
  wrap.append(head);

  const grid = el('div', { class: 'dash-grid' });

  /* ---- پڕۆژەی نوێ + بارکردن ---- */
  const newCard = el('div', { class: 'card dash-card' });
  newCard.innerHTML = `<h3>${icon('plus', 17)} ${t('dashNew')}</h3>`;
  const nameInput = el('input', { class: 'input', placeholder: t('dashNewName'), maxlength: '60' });
  const createBtn = el('button', { class: 'btn primary', html: `${icon('plus', 15)} ${t('dashCreate')}` });
  createBtn.addEventListener('click', async () => {
    const p = await Projects.create(nameInput.value.trim());
    resetSession();
    state.project = p;
    location.hash = '#/studio';
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') createBtn.click(); });
  const uploadBtn = el('button', { class: 'btn', html: `${icon('upload', 15)} ${t('dashUpload')}` });
  uploadBtn.addEventListener('click', () => { location.hash = '#/studio'; sessionStorage.setItem('os-open-picker', '1'); });
  newCard.append(nameInput, el('div', { class: 'dash-row', style: 'margin-top:10px' }, createBtn, uploadBtn));

  /* ---- کاری خێرا ---- */
  const quickCard = el('div', { class: 'card dash-card' });
  quickCard.innerHTML = `<h3>${icon('wand', 17)} ${t('dashQuick')}</h3><p style="color:var(--tx2);font-size:12.5px">${t('dashQuickD')}</p>`;
  const quickRow = el('div', { class: 'dash-row' });
  for (const g of QUICK_GOALS.slice(0, 3)) {
    const b = el('button', { class: 'btn small', html: `${icon(g.icon, 14)} ${t(g.label)}` });
    b.addEventListener('click', () => { location.hash = '#/studio'; sessionStorage.setItem('os-quick-enhance', '1'); });
    quickRow.append(b);
  }
  quickCard.append(quickRow);

  /* ---- پێشڕێکخستنەکان ---- */
  const presetCard = el('div', { class: 'card dash-card' });
  presetCard.innerHTML = `<h3>${icon('sliders', 17)} ${t('dashPresets')}</h3>`;
  const presetRow = el('div', { class: 'dash-row' });
  for (const p of CHAIN_PRESETS.slice(0, 4)) {
    const b = el('button', { class: 'btn small', html: `${icon(p.icon, 14)} ${t(p.id)}` });
    b.addEventListener('click', () => { location.hash = '#/studio'; sessionStorage.setItem('os-pending-preset', p.id); });
    presetRow.append(b);
  }
  presetCard.append(presetRow);
  grid.append(newCard, quickCard, presetCard);

  /* ---- پڕۆژەکان ---- */
  const projCard = el('div', { class: 'card dash-card w6' });
  projCard.innerHTML = `<h3>${icon('folder', 17)} ${t('dashProjects')}</h3>`;
  const projList = el('div', { class: 'proj-list' });
  projCard.append(projList);

  /* ---- کارە دواییەکان ---- */
  const recentCard = el('div', { class: 'card dash-card w6' });
  recentCard.innerHTML = `<h3>${icon('clock', 17)} ${t('dashRecent')}</h3>`;
  const recentList = el('div', { class: 'proj-list' });
  recentCard.append(recentList);

  /* ---- ئامرازەکان ---- */
  const toolsCard = el('div', { class: 'card dash-card w12' });
  toolsCard.innerHTML = `<h3>${icon('sliders', 17)} ${t('dashTools')}</h3>`;
  const toolsGrid = el('div', { class: 'grid-tools' });
  for (const id of ['voiceEnhancer', 'quickEnhance', 'noiseReduce', 'eq', 'compressor', 'reverb', 'deesser', 'limiter']) {
    const tool = TOOLS.find(x => x.id === id);
    if (!tool) continue;
    const card = el('button', { class: 'tool-card', html: `
      <span class="ic">${icon(tool.icon, 20)}</span>
      <b>${t(tool.label)}</b><span>${t(tool.desc)}</span>` });
    card.addEventListener('click', () => { location.hash = '#/studio'; sessionStorage.setItem('os-pending-tool', tool.id); });
    toolsGrid.append(card);
  }
  toolsCard.append(toolsGrid);
  grid.append(projCard, recentCard, toolsCard);
  wrap.append(grid);
  root.append(wrap);

  root.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) location.hash = '#/' + go.dataset.go;
  });

  async function refreshProjects() {
    projList.innerHTML = '';
    let list = [];
    try { list = await Projects.list(); } catch { list = []; }
    if (!list.length) {
      projList.append(el('div', { class: 'empty-note', text: t('dashNoProjects') }));
      return;
    }
    for (const p of list.slice(0, 8)) {
      const item = el('div', { class: 'proj-item' });
      item.innerHTML = `
        <div class="pi-ic" style="width:34px;height:34px;border-radius:10px;background:var(--bg3);color:var(--gold2);display:flex;align-items:center;justify-content:center;flex:none">${icon('music', 16)}</div>
        <div class="pi-main" role="button" tabindex="0">
          <div class="pi-name"></div>
          <div class="pi-meta"></div>
        </div>`;
      item.querySelector('.pi-name').textContent = p.name;
      item.querySelector('.pi-meta').textContent =
        `${t('updatedAt')}: ${timeAgo(p.updatedAt)} · ${p.duration ? t('fileInfoDuration') + ': ' + Math.round(p.duration) + ' ' + t('uSec') : ''}`;
      item.querySelector('.pi-main').addEventListener('click', async () => {
        const { openProject } = await import('./studio.js');
        openProject(p.id);
      });
      const acts = el('div', { class: 'pi-acts' });
      const dup = el('button', { class: 'mini-btn', 'aria-label': t('duplicate'), html: icon('copy', 14) });
      dup.addEventListener('click', async () => {
        await Projects.duplicate(p.id);
        toast(t('dashDuplicated'), 'success');
        refreshProjects();
      });
      const del = el('button', { class: 'mini-btn danger', 'aria-label': t('delete'), html: icon('trash', 14) });
      del.addEventListener('click', () => {
        confirmDlg(t('dashConfirmDelete'), async () => {
          await Projects.remove(p.id);
          toast(t('dashDeleted'), 'success');
          refreshProjects();
        });
      });
      acts.append(dup, del);
      item.append(acts);
      projList.append(item);
    }
  }

  function refreshRecent() {
    recentList.innerHTML = '';
    const log = state.historyLog || [];
    if (!log.length) {
      recentList.append(el('div', { class: 'empty-note', text: t('historyEmpty') }));
      return;
    }
    for (const h of log.slice(0, 8)) {
      const item = el('div', { class: 'proj-item' });
      item.innerHTML = `
        <div style="width:30px;height:30px;border-radius:9px;background:var(--bg3);color:var(--tx1);display:flex;align-items:center;justify-content:center;flex:none">${icon('clock', 14)}</div>
        <div class="pi-main"><div class="pi-name" style="font-family:var(--font-b);font-weight:400"></div>
        <div class="pi-meta num" dir="rtl"></div></div>`;
      item.querySelector('.pi-name').textContent = h.text;
      item.querySelector('.pi-meta').textContent = timeAgo(h.time);
      recentList.append(item);
    }
  }

  refreshProjects();
  refreshRecent();
}
