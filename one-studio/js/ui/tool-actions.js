/* ===== کردارەکانی ئامرازەکان — زیادکردن بۆ زنجیرە یان کردنەوەی دیالۆگ ===== */
import { TOOLS, REGISTRY } from '../effects/registry.js';
import { CHAIN_PRESETS } from '../effects/presets.js';
import { createInstance, instanceLabel } from '../effects/chain.js';
import { state, emit, pushUndo, logHistory } from '../state.js';
import { toast, confirmDlg, ls } from '../utils.js';
import { t } from '../l10n.js';
import {
  openNoiseDialog, openSilenceDialog, openClickDialog, openPitchDialog, openSpeedDialog,
  openVocalSepDialog, openLoudnessDialog, openNormalizeDialog, openQuickEnhance,
} from './dialogs.js';

export const favTools = {
  get: () => ls.get('fav-tools', {}),
  toggle(id) { const f = this.get(); if (f[id]) delete f[id]; else f[id] = 1; ls.set('fav-tools', f); return !!f[id]; },
};
export const recentTools = {
  push(id) {
    let r = ls.get('recent-tools', []).filter(x => x !== id);
    r.unshift(id);
    ls.set('recent-tools', r.slice(0, 6));
  },
  get: () => ls.get('recent-tools', []),
};

export function addChainEffect(type, paramsOverride = {}, logText = null) {
  const inst = createInstance(type, paramsOverride);
  state.chain.push(inst);
  state.selFx = inst.uid;
  pushUndo({
    log: t('hAddFx') + ': ' + instanceLabel(inst),
    undo() { state.chain = state.chain.filter(c => c.uid !== inst.uid); if (state.selFx === inst.uid) state.selFx = null; emit('chain'); },
    redo() { state.chain.push(inst); state.selFx = inst.uid; emit('chain'); },
  }, (logText || t('hAddFx') + ': ' + instanceLabel(inst)));
  emit('chain');
  return inst;
}

export function applyChainPresetById(presetId) {
  const preset = CHAIN_PRESETS.find(p => p.id === presetId);
  if (!preset) return false;
  const instances = preset.chain.map(d => createInstance(d.type, d.params));
  const old = state.chain;
  state.chain = instances;
  state.selFx = instances.length ? instances[instances.length - 1].uid : null;
  pushUndo({
    log: t('hPreset') + ': ' + t(preset.id),
    undo() { state.chain = old; emit('chain'); },
    redo() { state.chain = instances; emit('chain'); },
  }, t('hPreset') + ': ' + t(preset.id));
  return true;
}

export async function handleToolClick(tool) {
  recentTools.push(tool.id);
  emit('tools-changed');
  if (!state.working && tool.kind !== 'wizard') {
    toast(t('errNoFile'), 'warn');
    return;
  }
  switch (tool.kind) {
    case 'chain': {
      const inst = addChainEffect(tool.ref, tool.presetValues || {});
      emit('chain');
      toast(instanceLabel(inst) + ' — ' + t('hAddFx'), 'success', 2200);
      break;
    }
    case 'offline': {
      const def = REGISTRY[tool.ref];
      const params = { ...def.params.reduce((a, p) => (a[p.id] = p.def, a), {}), ...(tool.presetValues || {}) };
      if (tool.ref === 'noiseReduce') await openNoiseDialog(tool, params);
      else if (tool.ref === 'silenceRemove') await openSilenceDialog(tool, params);
      else if (tool.ref === 'clickClean') await openClickDialog(tool, params);
      else if (tool.ref === 'pitch') await openPitchDialog(tool, params);
      else if (tool.ref === 'speed') await openSpeedDialog(tool, params);
      break;
    }
    case 'wizard': openQuickEnhance(); break;
    case 'preset': {
      confirmDlg(t('presetApply') + ' — «' + t(tool.preset) + '»؟', () => {
        applyChainPresetById(tool.preset);
        emit('chain');
        toast(t('presetApplied'), 'success');
      }, t('apply'));
      break;
    }
    case 'loudness': openLoudnessDialog(); break;
    case 'normalize': openNormalizeDialog(); break;
    case 'unavailable': openVocalSepDialog(); break;
  }
}
