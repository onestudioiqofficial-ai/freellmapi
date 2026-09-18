/* ===== خاڵی دەستپێکی وان ستۆدیۆ ===== */
import { state, emit, busOn } from './state.js';
import { el, toast, hasOpenModal, closeAllModals } from './utils.js';
import { t, reportMissing } from './l10n.js';
import { renderLanding } from './ui/landing.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderStudio, openProject } from './ui/studio.js';
import { openQuickEnhance, openOnboarding } from './ui/dialogs.js';
import { handleToolClick, applyChainPresetById } from './ui/tool-actions.js';
import { engine } from './audio/engine.js';
import { TOOLS } from './effects/registry.js';

let currentCleanup = null;

function setView(view) {
  state.view = view;
  closeAllModals();
  currentCleanup?.destroy?.();
  currentCleanup = null;
  const root = document.getElementById('app');
  root.innerHTML = '';
  window.scrollTo(0, 0);
  if (view === 'landing') renderLanding(root);
  else if (view === 'dashboard') renderDashboard(root);
  else if (view === 'studio') {
    currentCleanup = renderStudio(root);
    // ئۆنبۆردینگی یەکەم جار
    let seen = false;
    try { seen = !!localStorage.getItem('one-studio:onboarding-seen'); } catch {}
    if (!seen) setTimeout(() => openOnboarding(), 500);
    // کارە چاوەڕوانەکان لە لەندینگ/داشبۆرد
    setTimeout(processPending, 250);
  } else if (view === 'privacy') renderPrivacy(root);
}

function processPending() {
  const toolId = sessionStorage.getItem('os-pending-tool');
  const presetId = sessionStorage.getItem('os-pending-preset');
  const openPicker = sessionStorage.getItem('os-open-picker');
  const quickEnhance = sessionStorage.getItem('os-quick-enhance');
  sessionStorage.removeItem('os-pending-tool');
  sessionStorage.removeItem('os-pending-preset');
  sessionStorage.removeItem('os-open-picker');
  sessionStorage.removeItem('os-quick-enhance');
  if (toolId) {
    const tool = TOOLS.find(x => x.id === toolId);
    if (tool) {
      if (state.working) handleToolClick(tool);
      else {
        // دوای بارکردنی فایل جێبەجێ بکرێت
        const off = busOn('file', () => { off(); setTimeout(() => handleToolClick(tool), 400); });
      }
    }
  }
  if (presetId) {
    if (state.working) applyChainPresetById(presetId);
    else {
      const off = busOn('file', () => { off(); setTimeout(() => applyChainPresetById(presetId), 400); });
    }
  }
  if (openPicker) {
    // کردنەوەی فایل پیکەر — دوای ڕێندەر
    setTimeout(() => document.querySelector('.drop-zone')?.click(), 300);
  }
  if (quickEnhance) {
    openQuickEnhance();
  }
}

/* ---- پەڕەی پاراستنی نهێنی ---- */
function renderPrivacy(root) {
  root.innerHTML = `
  <nav class="nav"><div class="nav-in">
    <div class="brand" data-go="landing" role="button" tabindex="0">
      <div class="mark">١</div>
      <div class="name">وان ستۆدیۆ<small>ستۆدیۆی دەنگی وێب</small></div>
    </div>
    <div class="nav-links"><a data-go="landing">${t('back')}</a></div>
  </div></nav>
  <div class="legal">
    <h1>${t('navPrivacy')}</h1>
    <p>وان ستۆدیۆ بە شێوەیەک دروست کراوە کە دەنگەکانت لای خۆت بمێننەوە. ئەم پەڕەیە بە ڕوونی باسی ئەوە دەکات کە چ ڕوو دەردەکەوێت.</p>
    <h2>پڕۆسەکردنی دەنگ لە کوێدا دەکرێت؟</h2>
    <p>هەموو پڕۆسەکردنێکی دەنگ — پاککردنەوە، EQ، کۆمپرێسەر، ڕیڤێرب، هەناردەکردن و هەموو ئامرازەکانی تر — بە تەواوی <b>لە ناو وێبگەڕەکەی خۆتدا</b> (client-side) بە Web Audio API جێبەجێ دەکرێت. فایلەکەت بۆ هیچ سێرڤەرێک نانێردرێت.</p>
    <h2>پاشەکەوتکردنی داتا</h2>
    <ul>
      <li>پڕۆژە و فایلەکان لە <b>IndexedDB</b>ی وێبگەڕەکەتدا پاشەکەوت دەکرێن — هەمان ئامێر، هەمان وێبگەڕ.</li>
      <li>ڕێکخستنە بچووکەکان (مۆد، دڵخوازەکان) لە <b>localStorage</b>دا.</li>
      <li>هیچ هەژمارێک، هیچ login ـێک و هیچ سێرڤەرێک نییە.</li>
    </ul>
    <h2>سنوورەکان — بە ڕاستگۆیی</h2>
    <ul>
      <li>ئەگەر داتای وێبگەڕەکەت بسڕیتەوە (Clear Site Data)، پڕۆژە پاشەکەوتکراوەکانیش دەسڕدرێنەوە — باکئەپ لە دەرەوەی ئەم پەڕەیە فایلەکانت خۆت هەڵبگرە.</li>
      <li>هیچ سیستەمێک ١٠٠٪ پارێزراو نییە؛ ئێمە دامەزراندنێکی بێ-سێرڤەری بەکارهێناوە بۆ کەمکردنەوەی مەترسی، بەڵام پاراستنی تەواو دەپەسەندرێت لەسەر ئامێری خۆت.</li>
      <li>ئامرازی «جیاکردنەوەی دەنگ» پێویستی بە مۆدێلێکی ML هەیە کە هێشتا بەردەست نییە — بۆیە هیچ ئەنجامێکی ساختە پیشان نادرێت.</li>
    </ul>
    <h2>کوکی و شوێنکەر</h2>
    <p>هیچ کوکی ڕیکلام و شوێنکەرێک بەکارناهێنرێت. تەنها localStorage بۆ ڕێکخستنەکانت.</p>
  </div>`;
  root.querySelector('.brand').addEventListener('click', () => { location.hash = '#/landing'; });
  root.querySelector('[data-go="landing"]').addEventListener('click', () => { location.hash = '#/landing'; });
}

/* ---- ڕووتینگ ---- */
function route() {
  const h = location.hash.replace(/^#\//, '') || 'landing';
  const view = ['landing', 'studio', 'dashboard', 'privacy'].includes(h) ? h : 'landing';
  setView(view);
}
window.addEventListener('hashchange', route);

/* ---- هەڵەکانی گشتی ---- */
window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('پڕۆمیس ڕەتکرایەوە:', e.reason);
});

route();
reportMissing();
