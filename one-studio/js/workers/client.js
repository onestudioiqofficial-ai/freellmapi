/* ===== کڵاینتی وۆرکەری DSP — پەیوەندی بە وۆرکەر یان فۆڵباکی سەرەکی ===== */
import { t } from '../l10n.js';
import { toast } from '../utils.js';

let worker = null;
let workerFailed = false;
let jobId = 0;
const pending = new Map();

function ensureWorker() {
  if (workerFailed) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./dsp-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { jobId: jid, progress, result, error } = e.data;
      const p = pending.get(jid);
      if (!p) return;
      if (progress !== undefined) p.onProgress?.(progress);
      if (error) { pending.delete(jid); p.reject(new Error(error === 'cancelled' ? 'cancelled' : error)); }
      else if (result) { pending.delete(jid); p.resolve(result); }
    };
    worker.onerror = (e) => {
      // فۆڵباک — هەموو ئەو کارانە لەسەر تەردی سەرەکی دەکرێن
      console.warn('[dsp] وۆرکەر کەوتەوە — فۆڵباک بۆ تەردی سەرەکی', e.message);
      workerFailed = true;
      worker = null;
      for (const [jid, p] of pending) { pending.delete(jid); p.reject(new Error('worker-dead')); }
    };
    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

export function cancelDsp() {
  worker?.postMessage({ op: 'cancel' });
  // فۆڵباکی تەردی سەرەکی: هەموو تۆکنە چالاکەکان هەڵوەشێنە
  for (const tk of activeTokens) tk.cancelled = true;
}
const activeTokens = new Set();

/**
 * runOp — جێبەجێکردنی کردارێکی DSP
 * fallback: فەنکشنێک کە لە تەردی سەرەکی جێبەجێ دەکرێت ئەگەر وۆرکەر نەبوو
 */
export async function runOp(op, payload, { onProgress, transfer = [], fallback } = {}) {
  const w = ensureWorker();
  if (w) {
    const jid = ++jobId;
    const token = { cancelled: false };
    activeTokens.add(token);
    try {
      return await new Promise((resolve, reject) => {
        pending.set(jid, { resolve, reject, onProgress, token });
        w.postMessage({ op, jobId: jid, ...payload }, [...transfer]);
      });
    } catch (err) {
      if (err.message === 'cancelled') throw err;
      if (err.message === 'worker-dead' && fallback) return await runFallback(op, payload, onProgress, fallback);
      throw err;
    } finally {
      activeTokens.delete(token);
    }
  }
  if (fallback) return await runFallback(op, payload, onProgress, fallback);
  throw new Error(t('errWorker'));
}

async function runFallback(op, payload, onProgress, fallbackFn) {
  try {
    return await fallbackFn(payload, onProgress);
  } catch (err) {
    if (String(err.message) === 'cancelled') throw err;
    console.error('[dsp-fallback]', err);
    throw new Error(t('errProcess'));
  }
}

export const workerAvailable = () => !workerFailed;
