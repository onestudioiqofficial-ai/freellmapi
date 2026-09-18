/* ===== ستۆدیۆ — سەرەکیترین شاشەی وان ستۆدیۆ ===== */
import { state, emit, busOn, undo, redo, resetSession, logHistory } from '../state.js';
import { engine } from '../audio/engine.js';
import { el, icon, toast, showProgress, ls, onFrame } from '../utils.js';
import { t } from '../l10n.js';
import { createToolsPanel } from './tools-panel.js';
import { createRack } from './rack.js';
import { createFxEditor } from './fx-editor.js';
import { createWaveformArea } from './waveform-ui.js';
import { createTransport } from './transport.js';
import { handleToolClick, applyChainPresetById } from './tool-actions.js';
import {
  openExportDialog, openPresetsDialog, openOnboarding, openShortcutsDialog,
  openHistoryDialog, openRenameDialog, openQuickEnhance,
} from './dialogs.js';
import { Projects } from '../projects/store.js';
import { TOOLS } from '../effects/registry.js';

export function renderStudio(root) {
  root.innerHTML = '';
  const app = el('div', { class: 'studio-app' });
  root.append(app);

  /* ---- بارێ سەرەوە ---- */
  const top = el('div', { class: 'studio-top' });
  top.innerHTML = `
    <div class="brand" data-go="landing" role="button" tabindex="0" aria-label="${t('app')}">
      <div class="mark">١</div>
      <div class="name">وان ستۆدیۆ<small>ستۆدیۆی دەنگی وێب</small></div>
    </div>
    <span class="sep"></span>`;
  const projName = el('button', { class: 'proj-name', html: `${icon('edit', 13)}<span>${t('projectUntitled')}</span>`, 'aria-label': t('rename') });
  projName.addEventListener('click', () => {
    openRenameDialog(state.project?.name || '', async (v) => {
      if (state.project) {
        state.project.name = v;
        try { await Projects.rename(state.project.id, v); } catch {}
      } else {
        state.project = await Projects.create(v).catch(() => null);
      }
      projName.querySelector('span').textContent = v;
      toast(t('dashRenamed'), 'success');
    });
  });
  top.append(projName);

  const undoBtn = el('button', { class: 'btn ghost small', 'aria-label': t('undo') + ' (Ctrl+Z)', title: t('undo'), html: icon('undo', 15) });
  undoBtn.addEventListener('click', () => { if (!undo()) toast(t('historyEmpty'), 'info', 1500); });
  const redoBtn = el('button', { class: 'btn ghost small', 'aria-label': t('redo') + ' (Ctrl+Shift+Z)', title: t('redo'), html: icon('redo', 15) });
  redoBtn.addEventListener('click', () => { if (!redo()) toast(t('historyEmpty'), 'info', 1500); });

  // مۆد
  const modeSeg = el('div', { class: 'tp-ab hide-sm', style: 'transform:scale(.92)', role: 'group', 'aria-label': t('modeSimple') });
  const simpleBtn = el('button', { text: t('modeSimple') });
  const advBtn = el('button', { text: t('modeAdvanced') });
  function renderMode() {
    simpleBtn.classList.toggle('on', state.mode === 'simple');
    advBtn.classList.toggle('on', state.mode === 'advanced');
  }
  simpleBtn.addEventListener('click', () => import('../state.js').then(({ setMode }) => setMode('simple')));
  advBtn.addEventListener('click', () => import('../state.js').then(({ setMode }) => setMode('advanced')));
  modeSeg.append(simpleBtn, advBtn);
  busOn('mode', renderMode);
  renderMode();

  const presetsBtn = el('button', { class: 'btn ghost small hide-sm', html: `${icon('sliders', 14)}<span>${t('presets')}</span>` });
  presetsBtn.addEventListener('click', () => openPresetsDialog());
  const historyBtn = el('button', { class: 'btn ghost small hide-sm', 'aria-label': t('history'), title: t('history'), html: icon('clock', 14) });
  historyBtn.addEventListener('click', () => openHistoryDialog());
  const helpBtn = el('button', { class: 'btn ghost small', 'aria-label': t('shortcuts'), title: t('shortcuts'), html: icon('keyboard', 15) });
  helpBtn.addEventListener('click', () => openShortcutsDialog());
  const dashBtn = el('button', { class: 'btn ghost small', 'aria-label': t('navDashboard'), title: t('navDashboard'), html: icon('home', 15) });
  dashBtn.addEventListener('click', () => { location.hash = '#/dashboard'; });
  const saveBtn = el('button', { class: 'btn ghost small', html: `${icon('save', 14)}<span>${t('save')}</span>` });
  const exportBtn = el('button', { class: 'btn primary small', html: `${icon('export', 14)}<span>${t('export')}</span>` });
  exportBtn.addEventListener('click', () => openExportDialog());

  // دوگمەکانی پشیلە بۆ مۆبایل
  const toolsDrawerBtn = el('button', { class: 'btn ghost small mobile-drawer-btn', 'aria-label': t('allTools'), html: icon('sliders', 15) });
  const rackDrawerBtn = el('button', { class: 'btn ghost small mobile-drawer-btn', 'aria-label': t('rack'), html: icon('layers', 15) });

  const actions = el('div', { class: 'top-actions' });
  actions.append(toolsDrawerBtn, rackDrawerBtn, undoBtn, redoBtn, modeSeg, historyBtn, helpBtn, presetsBtn, dashBtn, saveBtn, exportBtn);
  top.append(actions);
  app.append(top);

  /* ---- سێ پانێڵ ---- */
  const main = el('div', { class: 'studio-main' });
  const tools = createToolsPanel();
  const rack = createRack();
  const fxEditor = createFxEditor();
  const center = el('div', { class: 'studio-center' });
  const waveArea = createWaveformArea();
  center.append(waveArea.root, fxEditor.root);
  // بەپێی RTL: ڕاک لە ڕاستەوە = یەکەم منداڵ
  main.append(rack.root, center, tools.root);
  app.append(main);

  /* ---- ترنسپۆرت ---- */
  const transport = createTransport();
  app.append(transport.root);

  /* ---- دواکردنی کلیلی خێرا ---- */
  function onKey(e) {
    const inInput = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (e.key === ' ' && !inInput) {
      e.preventDefault();
      engine.togglePlay();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault(); undo();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault(); redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault(); openExportDialog();
    } else if (inInput) {
      return;
    } else if (e.key === '+' || e.key === '=') {
      waveArea.view.zoom(1 / 1.5);
    } else if (e.key === '-' || e.key === '_') {
      waveArea.view.zoom(1.5);
    } else if (e.key === 'Delete') {
      waveArea.ops.remove();
    } else if (e.key.toLowerCase() === 's') {
      waveArea.ops.split();
    } else if (e.key.toLowerCase() === 'l') {
      state.loop = !state.loop;
      if (engine.isPlaying) engine.play(engine.position);
    } else if (e.key.toLowerCase() === 'b') {
      const nc = state.compare === 'after' ? 'before' : 'after';
      state.compare = nc;
      engine.setCompare(nc);
      transport.root.querySelectorAll('.tp-ab button').forEach((b, i) => b.classList.toggle('on', (i === 0) === (nc === 'before')));
    } else if (e.key === '?') {
      openShortcutsDialog();
    }
  }
  window.addEventListener('keydown', onKey);

  /* ---- لوپ ---- */
  const offFrame = onFrame(() => {
    waveArea.tick();
    transport.tick();
    rack.tickMeters();
  });

  /* ---- ئیڤنتی زنجیرە ---- */
  busOn('chain', () => {
    engine.chainStructureChanged();
    rack.render();
    fxEditor.render();
  });
  busOn('file', () => {
    // نوێکردنەوەی ناوی پڕۆژە
    projName.querySelector('span').textContent = state.project?.name || state.fileName || t('projectUntitled');
  });
  busOn('history', () => {
    undoBtn.disabled = !state.undoStack.length;
    redoBtn.disabled = !state.redoStack.length;
  });

  /* ---- پاشەکەوتکردن ---- */
  saveBtn.addEventListener('click', async () => {
    if (!state.working) { toast(t('errNoFile'), 'warn'); return; }
    const pr = showProgress({ text: t('projectSaving'), cancelable: false });
    try {
      if (!state.project) {
        const baseName = (state.fileName || t('projectUntitled')).replace(/\.[^.]+$/, '');
        state.project = await Projects.create(baseName);
      }
      const meta = await Projects.save(state.project);
      state.dirty = false;
      pr.close();
      projName.querySelector('span').textContent = meta.name;
      toast(t('projectSaved'), 'success');
      logHistory(t('save'));
    } catch (e) {
      pr.close();
      console.error(e);
      toast(t('errSave'), 'error');
    }
  });

  /* ---- پشیلەکانی مۆبایل ---- */
  function toggleDrawer(side, open) {
    const panel = side === 'tools' ? tools.root : rack.root;
    panel.classList.toggle('open', open);
    // داخستن بە دەرەوەی کلیک
    if (open) {
      const closer = (e) => {
        if (!panel.contains(e.target) && e.target.closest('.studio-top') === null) {
          panel.classList.remove('open');
          document.removeEventListener('pointerdown', closer);
        }
      };
      setTimeout(() => document.addEventListener('pointerdown', closer), 60);
    }
  }
  toolsDrawerBtn.addEventListener('click', () => toggleDrawer('tools', !tools.root.classList.contains('open')));
  rackDrawerBtn.addEventListener('click', () => toggleDrawer('rack', !rack.root.classList.contains('open')));

  top.querySelector('.brand').addEventListener('click', () => { location.hash = '#/landing'; });

  /* ---- پڕۆژەی چاوەڕوان ---- */
  emit('history');

  return {
    destroy() {
      window.removeEventListener('keydown', onKey);
      offFrame();
    },
  };
}

/* ---- کردنەوەی پڕۆژە لە داشبۆرد ---- */
export async function openProject(id) {
  const pr = showProgress({ text: t('loadingFile') });
  try {
    const { meta, buffer, originalBlob } = await Projects.load(id);
    resetSession();
    state.project = meta;
    state.originalFileBlob = originalBlob;
    const { setFile } = await import('../state.js');
    setFile(buffer, meta.fileName || meta.name, 0);
    state.chain = (meta.chain || []).map(c => ({ ...c }));
    state.markers = meta.markers || [];
    location.hash = '#/studio';
    pr.close();
    toast(t('projectLoaded'), 'success');
  } catch (e) {
    pr.close();
    console.error(e);
    toast(t('projectLoadFail'), 'error');
  }
}
