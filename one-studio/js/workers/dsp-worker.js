/* ===== وۆرکەری DSP — کارە قورسەکان لە دەرەوەی تەردی سەرەکی ===== */
import { learnNoise, spectralDenoise, clickRepair, detectSilences, removeSilences, measureLoudness, gainForPeak } from '../dsp/repair.js';
import { resampleChannel, timeStretch, speedPreserve, pitchShiftChannel } from '../dsp/stretch.js';
import { FFT, hann } from '../dsp/fft.js';

let cancelled = false;

self.onmessage = async (e) => {
  const { op, jobId } = e.data;
  if (op === 'cancel') { cancelled = true; return; }
  cancelled = false;
  const post = (msg, transfer) => self.postMessage({ jobId, ...msg }, transfer || []);
  const prog = (p) => post({ progress: p });
  const isCancelled = () => cancelled;
  const ch = e.data.channels || [];
  const sr = e.data.sampleRate || 44100;

  try {
    switch (op) {
      case 'peaks': {
        const bucket = e.data.bucket;
        const total = Math.ceil(ch[0].length / bucket);
        const mins = new Float32Array(total), maxs = new Float32Array(total);
        for (let b = 0; b < total; b++) {
          if ((b & 8191) === 0 && isCancelled()) return post({ error: 'cancelled' });
          let mn = 1, mx = -1;
          const s = b * bucket, end = Math.min(ch[0].length, s + bucket);
          for (let c = 0; c < ch.length; c++) {
            const d = ch[c];
            for (let i = s; i < end; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
          }
          mins[b] = mn === 1 ? 0 : mn; maxs[b] = mx === -1 ? 0 : mx;
          if ((b & 2047) === 0) prog(b / total);
        }
        return post({ result: { mins, maxs, bucket } }, [mins.buffer, maxs.buffer]);
      }
      case 'noiseProfile': {
        const p = learnNoise(ch, sr, e.data.aSec, e.data.bSec, e.data.frame || 2048);
        if (!p) return post({ error: 'nop' });
        return post({ result: p }, [p.mag.buffer]);
      }
      case 'denoise': {
        const out = await spectralDenoise(ch, sr, e.data.profile, e.data.opts, prog, isCancelled);
        if (!out) return post({ error: 'cancelled' });
        return post({ result: { channels: out } }, out.map(c => c.buffer));
      }
      case 'clicks': {
        const r = clickRepair(ch, sr, e.data.opts, prog, isCancelled);
        if (!r) return post({ error: 'cancelled' });
        return post({ result: r }, r.channels.map(c => c.buffer));
      }
      case 'silences': {
        const regions = detectSilences(ch, sr, e.data.opts);
        return post({ result: { regions } });
      }
      case 'cutSilences': {
        const out = removeSilences(ch, sr, e.data.regions, e.data.pad ?? 0.08);
        return post({ result: { channels: out } }, out.map(c => c.buffer));
      }
      case 'loudness': {
        const stats = await measureLoudness(ch, sr, prog, isCancelled);
        if (!stats) return post({ error: 'cancelled' });
        return post({ result: stats });
      }
      case 'gainForPeak': {
        return post({ result: { gainDb: gainForPeak(ch, e.data.targetDb) } });
      }
      case 'speed': {
        const { rate, preserve } = e.data;
        const out = ch.map(d => {
          if (isCancelled()) throw new Error('cancelled');
          return preserve ? speedPreserve(d, rate) : resampleChannel(d, rate);
        });
        if (cancelled) return post({ error: 'cancelled' });
        prog(1);
        return post({ result: { channels: out } }, out.map(c => c.buffer));
      }
      case 'pitch': {
        const out = ch.map(d => {
          if (isCancelled()) throw new Error('cancelled');
          return pitchShiftChannel(d, e.data.semitones);
        });
        if (cancelled) return post({ error: 'cancelled' });
        prog(1);
        return post({ result: { channels: out } }, out.map(c => c.buffer));
      }
      case 'wavEncode': {
        const blobBuf = encodeWav(ch, sr, e.data.bitDepth || 16);
        return post({ result: { buffer: blobBuf } }, [blobBuf]);
      }
      default:
        return post({ error: 'نەناسراو: ' + op });
    }
  } catch (err) {
    return post({ error: String(err && err.message || err) });
  }
};

function encodeWav(channels, sampleRate, bitDepth) {
  const numCh = channels.length;
  const len = channels[0].length;
  const bytesPerSample = bitDepth === 32 ? 4 : bitDepth === 24 ? 3 : 2;
  const dataSize = len * numCh * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const wstr = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  wstr(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytesPerSample, true);
  v.setUint16(32, numCh * bytesPerSample, true);
  v.setUint16(34, bitDepth, true);
  wstr(36, 'data'); v.setUint32(40, dataSize, true);
  let off = 44;
  if (bitDepth === 32) {
    for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) { v.setFloat32(off, channels[c][i], true); off += 4; }
  } else if (bitDepth === 24) {
    for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      let iv = Math.round(s * 8388607);
      v.setUint8(off, iv & 0xff); v.setUint8(off + 1, (iv >> 8) & 0xff); v.setUint8(off + 2, (iv >> 16) & 0xff); off += 3;
    }
  } else {
    for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(off, Math.round(s * 32767), true); off += 2;
    }
  }
  return buf;
}
