/* ===== پاشەکەوتکردنی پڕۆژەکان — IndexedDB ===== */
import { engine } from '../audio/engine.js';
import { state } from '../state.js';
import { uid } from '../utils.js';
import { runOp } from '../workers/client.js';
import { t } from '../l10n.js';
import { toast } from '../utils.js';

const DB_NAME = 'one-studio';
const DB_VER = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tr = db.transaction(store, mode);
    const st = tr.objectStore(store);
    const out = fn(st);
    tr.oncomplete = () => { db.close(); resolve(out?.result !== undefined ? out.result : out); };
    tr.onerror = () => { db.close(); reject(tr.error); };
  });
}

export const Projects = {
  async list() {
    const rows = await new Promise(async (resolve, reject) => {
      try {
        const db = await openDb();
        const tr = db.transaction('projects', 'readonly');
        const req = tr.objectStore('projects').getAll();
        req.onsuccess = () => { db.close(); resolve(req.result || []); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch (e) { reject(e); }
    });
    return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },

  async create(name) {
    const p = {
      id: uid(),
      name: name || t('projectUntitled'),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      chain: [],
      markers: [],
    };
    await tx('projects', 'readwrite', st => st.put(p));
    return p;
  },

  async save({ id, name }) {
    if (!state.working) throw new Error(t('errNoFile'));
    // کۆدی WAV بۆ working — بۆ کردنەوەی دووبارە
    const channels = engine.channelData(state.working);
    const progToast = null;
    const res = await runOp('wavEncode', { channels, sampleRate: state.working.sampleRate, bitDepth: 16 });
    const workingBlob = new Blob([res.buffer], { type: 'audio/wav' });
    const originalBlob = state.originalFileBlob || workingBlob;
    const meta = {
      id,
      name: name || state.project?.name || t('projectUntitled'),
      createdAt: state.project?.createdAt || Date.now(),
      updatedAt: Date.now(),
      chain: state.chain,
      markers: state.markers || [],
      fileName: state.fileName,
      duration: state.working.duration,
      sampleRate: state.working.sampleRate,
      channels: state.working.numberOfChannels,
    };
    await tx('projects', 'readwrite', st => st.put(meta));
    await tx('blobs', 'readwrite', st => st.put({ original: originalBlob, working: workingBlob }, id));
    return meta;
  },

  async load(id) {
    const meta = await new Promise(async (resolve, reject) => {
      try {
        const db = await openDb();
        const tr = db.transaction('projects', 'readonly');
        const req = tr.objectStore('projects').get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch (e) { reject(e); }
    });
    if (!meta) throw new Error(t('projectLoadFail'));
    const blobs = await new Promise(async (resolve, reject) => {
      try {
        const db = await openDb();
        const tr = db.transaction('blobs', 'readonly');
        const req = tr.objectStore('blobs').get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch (e) { reject(e); }
    });
    if (!blobs?.working) throw new Error(t('projectLoadFail'));
    const ab = await blobs.working.arrayBuffer();
    const buf = await engine.decodeFile(ab);
    return { meta, buffer: buf, originalBlob: blobs.original || null };
  },

  async rename(id, name) {
    const meta = await new Promise(async (resolve, reject) => {
      try {
        const db = await openDb();
        const tr = db.transaction('projects', 'readonly');
        const req = tr.objectStore('projects').get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch (e) { reject(e); }
    });
    if (!meta) throw new Error(t('projectLoadFail'));
    meta.name = name;
    meta.updatedAt = Date.now();
    await tx('projects', 'readwrite', st => st.put(meta));
    return meta;
  },

  async remove(id) {
    await tx('projects', 'readwrite', st => st.delete(id));
    await tx('blobs', 'readwrite', st => st.delete(id));
  },

  async duplicate(id) {
    const list = await Projects.list();
    const src = list.find(p => p.id === id);
    if (!src) throw new Error(t('projectLoadFail'));
    const copy = { ...src, id: uid(), name: src.name + ' — کۆپی', createdAt: Date.now(), updatedAt: Date.now() };
    await tx('projects', 'readwrite', st => st.put(copy));
    const blobs = await new Promise(async (resolve, reject) => {
      try {
        const db = await openDb();
        const tr = db.transaction('blobs', 'readonly');
        const req = tr.objectStore('blobs').get(id);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
      } catch (e) { reject(e); }
    });
    if (blobs) await tx('blobs', 'readwrite', st => st.put(blobs, copy.id));
    return copy;
  },
};
