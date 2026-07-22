// subtitles.js — local speech-to-text subtitles via transformers.js
// (Whisper ONNX) + optional local translation (opus-mt). Models download
// once on first use (~80-120 MB) into the HF cache, then work offline.
// No audio ever leaves the machine.

const fs = require('fs/promises');

// Pipelines are expensive to build; cache per model.
const pipelines = new Map();

async function getPipeline(task, model, onStatus) {
  const key = `${task}:${model}`;
  if (!pipelines.has(key)) {
    // @huggingface/transformers is ESM-only; dynamic import from CJS.
    const { pipeline } = await import('@huggingface/transformers');
    const p = await pipeline(task, model, {
      dtype: 'q8',
      progress_callback: (info) => {
        if (info.status === 'progress' && onStatus) {
          onStatus(`Downloading model ${info.file} — ${Math.round(info.progress || 0)}% (one-time)`);
        }
      }
    });
    pipelines.set(key, p);
  }
  return pipelines.get(key);
}

/**
 * Parse a 16-bit PCM mono WAV file into Float32Array samples.
 * We control the ffmpeg args that produce it, so the format is fixed.
 */
function wavToFloat32(buffer) {
  // Find the 'data' chunk instead of assuming a 44-byte header.
  let offset = 12;
  while (offset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'data') {
      const samples = new Float32Array(chunkSize / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = buffer.readInt16LE(offset + 8 + i * 2) / 32768;
      }
      return samples;
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  throw new Error('No data chunk found in WAV file');
}

/**
 * Transcribe a 16 kHz mono WAV into timed segments, optionally translated.
 * @param {string} wavPath
 * @param {'original'|'en'|'fr'|'de'|'es'} target
 * @param {(msg: string) => void} onStatus
 * @returns {Promise<Array<{start: number, end: number, text: string}>>}
 */
async function transcribe(wavPath, target, onStatus) {
  const audio = wavToFloat32(await fs.readFile(wavPath));

  onStatus('Transcribing speech (local Whisper)…');
  const asr = await getPipeline(
    'automatic-speech-recognition',
    'Xenova/whisper-base',
    onStatus
  );

  // 'original' keeps the spoken language; any other target goes through
  // English first (Whisper can only translate toward English).
  const result = await asr(audio, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
    task: target === 'original' ? 'transcribe' : 'translate'
  });

  let segments = (result.chunks || [])
    .filter((c) => c.text && c.text.trim())
    .map((c, i, arr) => ({
      start: c.timestamp[0] ?? 0,
      // Last chunk can have a null end timestamp; give it a short tail.
      end: c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 3,
      text: c.text.trim()
    }));

  if (target === 'fr' || target === 'de' || target === 'es') {
    onStatus(`Translating subtitles to ${target.toUpperCase()} (local model)…`);
    const translator = await getPipeline('translation', `Xenova/opus-mt-en-${target}`, onStatus);
    for (let i = 0; i < segments.length; i++) {
      const out = await translator(segments[i].text);
      segments[i].text = out[0].translation_text;
      onStatus(`Translating subtitles… ${i + 1}/${segments.length}`);
    }
  }

  return segments;
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(rest, 3)}`;
}

function toSrt(segments) {
  return segments
    .map((seg, i) => `${i + 1}\n${srtTime(seg.start)} --> ${srtTime(seg.end)}\n${seg.text}\n`)
    .join('\n');
}

module.exports = { transcribe, toSrt };
