/* ===== State ی ناوەندی ===== */
import { uid, ls } from './utils.js';
import { t } from './l10n.js';

export const state = {
  view: 'landing',            // landing | studio | dashboard | privacy
  project: null,              // {id, name, createdAt, updatedAt}
  original: null,             // AudioBuffer — هەرگیز ناگۆڕدرێت
  working: null,              // AudioBuffer — دەستکاری دەکرێت (دەشێت بگەڕێتەوە)
  fileName: '',
  fileSize: 0,
  selection: null,            // {a, b} بە چرکە
  markers: [],                // [چرکە]
  tempRegions: null,          // [{a,b}] — بۆ پێشبینینی ناو دیالۆگ
  viewA: 0, viewB: 1,         // پەنجەرەی زووم
  playing: false,
  position: 0,
  compare: 'after',           // after | before
  loop: false,
  chain: [],                  // [{uid, type, params, enabled, bypassed, note}]
  selFx: null,                // uid ی ئەفێکتی هەڵبژێردراو بۆ دەستکاری
  mode: ls.get('mode', 'simple'),
  undoStack: [],
  redoStack: [],
  historyLog: [],             // [{text, time}]
  dirty: false,               // پاشەکەوتنەکراو
  presetPreview: null,        // زانیاری پێشبینینی پێشڕێکخستن
};

const listeners = new Map();
export function busOn(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt)?.delete(fn);
}
export function emit(evt, payload) {
  listeners.get(evt)?.forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
}

export function logHistory(text) {
  state.historyLog.unshift({ text, time: Date.now() });
  if (state.historyLog.length > 120) state.historyLog.pop();
  emit('history');
}

/* ---- Undo / Redo ---- */
const MAX_EDIT_UNDO = 15;
export function pushUndo(cmd, logText) {
  state.undoStack.push(cmd);
  if (cmd.holdsAudio && state.undoStack.filter(c => c.holdsAudio).length > MAX_EDIT_UNDO) {
    const i = state.undoStack.findIndex(c => c.holdsAudio);
    if (i >= 0) state.undoStack.splice(i, 1);
  }
  state.redoStack.length = 0;
  state.dirty = true;
  if (logText) logHistory(logText);
  emit('history');
}
export function undo() {
  const cmd = state.undoStack.pop();
  if (!cmd) return false;
  cmd.undo();
  state.redoStack.push(cmd);
  logHistory('↩ ' + t('hUndo') + (cmd.log ? ' — ' + cmd.log : ''));
  emit('history'); emit('edit-done');
  return true;
}
export function redo() {
  const cmd = state.redoStack.pop();
  if (!cmd) return false;
  cmd.redo();
  state.undoStack.push(cmd);
  logHistory('↪ ' + t('hRedo') + (cmd.log ? ' — ' + cmd.log : ''));
  emit('history'); emit('edit-done');
  return true;
}

/* ---- فایل ---- */
export function setFile(buffer, name, size) {
  state.original = buffer;
  state.working = buffer;
  state.fileName = name;
  state.fileSize = size;
  state.selection = null;
  state.markers = [];
  state.tempRegions = null;
  state.viewA = 0; state.viewB = buffer.duration;
  state.position = 0;
  state.playing = false;
  state.dirty = false;
  emit('file');
}
export function setWorking(buffer, opts = {}) {
  state.working = buffer;
  if (!opts.keepSelection) state.selection = null;
  state.markers = (state.markers || []).filter(m => m <= buffer.duration);
  if (state.viewB > buffer.duration) { state.viewA = 0; state.viewB = buffer.duration; }
  emit('file');
}
export const hasFile = () => !!state.working;
export const duration = () => state.working ? state.working.duration : 0;

/* ---- هەڵبژاردن ---- */
export function setSelection(a, b) {
  if (a > b) [a, b] = [b, a];
  state.selection = (b - a < 0.005) ? null : { a, b };
  emit('selection');
}
export const selSamples = () => {
  if (!state.selection || !state.working) return null;
  const sr = state.working.sampleRate;
  return { i0: Math.max(0, Math.round(state.selection.a * sr)), i1: Math.min(state.working.length, Math.round(state.selection.b * sr)) };
};

/* ---- زنجیرە ---- */
export function replaceChain(chain, logText) {
  const old = state.chain;
  state.chain = chain;
  state.selFx = chain.length ? chain[chain.length - 1].uid : null;
  pushUndo({
    log: logText,
    undo() { state.chain = old; emit('chain'); },
    redo() { state.chain = chain; emit('chain'); },
  }, logText);
  emit('chain');
}
export function saveStateSnapshot() {
  return { chain: state.chain, markers: [...state.markers], selFx: state.selFx };
}

/* ---- مۆد ---- */
export function setMode(m) { state.mode = m; ls.set('mode', m); emit('mode'); }

export function resetSession() {
  state.project = null;
  state.original = state.working = null;
  state.fileName = ''; state.fileSize = 0;
  state.selection = null; state.markers = []; state.tempRegions = null;
  state.chain = []; state.selFx = null;
  state.undoStack = []; state.redoStack = []; state.historyLog = [];
  state.playing = false; state.position = 0;
  state.compare = 'after'; state.loop = false;
  state.dirty = false;
  emit('file'); emit('chain'); emit('history');
}
