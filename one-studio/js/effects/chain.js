/* ===== زنجیرەی ئەفێکتەکان — دروستکردن و ڕێکخستنی گرافی دەنگ ===== */
import { REGISTRY, defaultParams } from './registry.js';
import { uid } from '../utils.js';
import { t } from '../l10n.js';

export function createInstance(type, paramsOverride = {}) {
  return {
    uid: uid(),
    type,
    params: { ...defaultParams(type), ...paramsOverride },
    enabled: true,
    bypassed: false,
  };
}

export const findInstance = (chain, uidv) => chain.find(c => c.uid === uidv);

export function moveInstance(chain, uidv, dir) {
  const i = chain.findIndex(c => c.uid === uidv);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= chain.length) return false;
  [chain[i], chain[j]] = [chain[j], chain[i]];
  return true;
}

export function instanceLabel(inst) {
  const def = REGISTRY[inst.type];
  return def ? t(def.label) : inst.type;
}

/* ---- چەمکەر — گەڕانەوەی دەنگی بێ ئەفێکت بە یەک کلیک و بێ پچڕان ---- */
function bypassWrap(ctx, impl) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const wet = ctx.createGain(), dry = ctx.createGain();
  wet.gain.value = 1; dry.gain.value = 0;
  input.connect(impl.input);
  impl.output.connect(wet); wet.connect(output);
  input.connect(dry); dry.connect(output);
  return {
    impl,
    input,
    output,
    setBypass(b) {
      wet.gain.setTargetAtTime(b ? 0 : 1, 0, 0.015);
      dry.gain.setTargetAtTime(b ? 1 : 0, 0, 0.015);
    },
    dispose() {
      try { input.disconnect(); dry.disconnect(); wet.disconnect(); output.disconnect(); } catch {}
      impl.dispose?.();
    },
  };
}

/**
 * buildGraph — دروستکردنی گراف لە ctx (Live یان Offline)
 * res: { workletOk: boolean }
 */
export function buildGraph(ctx, chain, res) {
  const wrappers = [];
  let head = null, tail = null;
  for (const inst of chain) {
    if (!inst.enabled) continue;
    const def = REGISTRY[inst.type];
    if (!def || typeof def.build !== 'function') continue;
    try {
      const impl = def.build(ctx, inst.params, res);
      const wrapped = bypassWrap(ctx, impl);
      wrapped.setBypass(!!inst.bypassed);
      wrapped.inst = inst;
      if (head === null) head = wrapped;
      else tail.output.connect(wrapped.input);
      tail = wrapped;
      wrappers.push(wrapped);
    } catch (e) {
      console.error('هەڵە لە دروستکردنی ئەفێکت:', inst.type, e);
    }
  }
  let input, output;
  if (!wrappers.length) {
    input = ctx.createGain();
    output = input; // پەسەڕاستەوخۆ
  } else {
    input = head.input;
    output = tail.output;
  }
  return {
    input, output, wrappers,
    setBypass(instUid, b) {
      wrappers.find(w => w.inst?.uid === instUid)?.setBypass(b);
    },
    updateParams(inst) {
      const w = wrappers.find(x => x.inst?.uid === inst.uid);
      if (w) w.impl.set?.({ ...inst.params });
    },
    gainReduction() {
      let gr = 0;
      for (const w of wrappers) {
        const v = w.impl.gr?.();
        if (typeof v === 'number' && v < gr) gr = v;
      }
      return gr;
    },
    dispose() { wrappers.forEach(w => w.dispose()); },
  };
}
