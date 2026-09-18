/* ===== هەناردەکردن — ڕێندەری ئۆفلاین و کۆدکردنی فایل ===== */
import { buildGraph } from '../effects/chain.js';
import { engine } from './engine.js';
import { state } from '../state.js';
import { runOp } from '../workers/client.js';
import { t } from '../l10n.js';

/* پشتگیری کۆدەرەکان — بە ڕاستی دەستنیشان دەکرێت */
export async function supportedFormats() {
  const f = { wav: true, mp3: false, ogg: false };
  try {
    if (typeof AudioEncoder !== 'undefined') {
      const r = await AudioEncoder.isConfigSupported({ codec: 'mp3', sampleRate: 44100, bitrate: 192000, numberOfChannels: 2 });
      f.mp3 = !!r?.supported;
    }
  } catch { f.mp3 = false; }
  try {
    if (typeof MediaRecorder !== 'undefined') {
      f.ogg = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus');
    }
  } catch { f.ogg = false; }
  return f;
}

/* ---- ڕێندەری ئۆفلاین بە زنجیرەی ئەفێکتەکان ---- */
export async function renderProcessed({ sampleRate = null, channels = null, chain = null, onProgress } = {}) {
  if (!state.working) throw new Error(t('errNoFile'));
  const src = state.working;
  const sr = sampleRate || src.sampleRate;
  const nCh = channels || src.numberOfChannels;
  const length = Math.ceil(src.duration * sr);
  const oc = new OfflineAudioContext(nCh, length, sr);
  let res = { workletOk: false };
  try {
    await oc.audioWorklet.addModule(new URL('../workers/dsp-worklet.js', import.meta.url));
    res.workletOk = true;
  } catch { res.workletOk = false; }
  const graph = buildGraph(oc, (chain || state.chain).filter(c => c.enabled), res);
  const source = oc.createBufferSource();
  source.buffer = src;
  source.connect(graph.input);
  graph.output.connect(oc.destination);
  source.start(0);
  const rendered = await oc.startRendering();
  graph.dispose();
  onProgress?.(1);
  return rendered;
}

/* ---- کۆدکردنی WAV ---- */
export async function encodeWav(buffer, bitDepth = 16, onProgress) {
  const channels = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const res = await runOp('wavEncode', {
    channels, sampleRate: buffer.sampleRate, bitDepth,
  }, { onProgress });
  return new Blob([res.buffer], { type: 'audio/wav' });
}

/* ---- کۆدکردنی MP3 بە WebCodecs (ئەگەر وێبگەڕ پشتگیری بکات) ---- */
export async function encodeMp3(buffer, bitrate = 192, onProgress) {
  if (typeof AudioEncoder === 'undefined') throw new Error(t('exportMp3Unsupported'));
  const config = { codec: 'mp3', sampleRate: buffer.sampleRate, bitrate: bitrate * 1000, numberOfChannels: Math.min(2, buffer.numberOfChannels) };
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support?.supported) throw new Error(t('exportMp3Unsupported'));
  const chunks = [];
  let encoded = 0;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push(data);
      encoded += data.length;
    },
    error: (e) => { throw e; },
  });
  enc.configure(config);
  const nCh = config.numberOfChannels;
  const len = buffer.length;
  const BLOCK = 48000; // بلۆکەکان بۆ پێشکەوتن
  const pos = { index: 0 };
  for (let start = 0; start < len; start += BLOCK) {
    const end = Math.min(len, start + BLOCK);
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: buffer.sampleRate,
      numberOfFrames: end - start,
      numberOfChannels: nCh,
      timestamp: Math.round(start / buffer.sampleRate * 1e6),
      data: planarSlice(buffer, start, end, nCh),
    });
    enc.encode(data);
    data.close();
    onProgress?.(end / len);
    if (enc.encodeQueueSize > 8) {
      await new Promise(r => setTimeout(r, 0));
    }
  }
  await enc.flush();
  enc.close();
  return new Blob(chunks, { type: 'audio/mpeg' });
}
function planarSlice(buffer, start, end, nCh) {
  const frames = end - start;
  const out = new Float32Array(frames * nCh);
  for (let c = 0; c < nCh; c++) {
    out.set(buffer.getChannelData(c).subarray(start, end), c * frames);
  }
  return out;
}

/* ---- کۆدکردنی OGG بە MediaRecorder (ڕێندەری زیندوو) ---- */
export async function encodeOgg(buffer, onProgress) {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
    throw new Error(t('exportOggUnsupported'));
  }
  const ctx = new AudioContext({ sampleRate: buffer.sampleRate });
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/ogg;codecs=opus', audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); onProgress?.(Math.min(0.98, ctx.currentTime / buffer.duration)); };
  const done = new Promise((resolve) => { rec.onstop = resolve; });
  rec.start(250);
  src.start();
  await new Promise((resolve) => { src.onended = resolve; });
  await new Promise(r => setTimeout(r, 300));
  rec.stop();
  await done;
  ctx.close();
  onProgress?.(1);
  return new Blob(chunks, { type: 'audio/ogg' });
}

/* ---- داگرتن ---- */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
}

/* ---- ناردنی فایل بۆ پڕۆژە (blob ی WAV بۆ IDB) ---- */
export async function bufferToWavBlob(buffer, bitDepth = 16) {
  return await encodeWav(buffer, bitDepth);
}
