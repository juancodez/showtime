// recorder.js — mixes audio sources and records the composited canvas
// stream with MediaRecorder into a single WebM blob.

function pickMimeType() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class Recorder {
  /**
   * @param {MediaStream} videoStream canvas captureStream
   * @param {MediaStream[]} audioStreams any streams whose audio tracks
   *        should be mixed in (mic, system loopback). Streams without
   *        audio tracks are ignored.
   */
  constructor(videoStream, audioStreams = []) {
    this.audioCtx = null;
    const tracks = [...videoStream.getVideoTracks()];

    const withAudio = audioStreams.filter((s) => s && s.getAudioTracks().length > 0);
    if (withAudio.length > 0) {
      this.audioCtx = new AudioContext();
      const dest = this.audioCtx.createMediaStreamDestination();
      for (const s of withAudio) {
        this.audioCtx.createMediaStreamSource(s).connect(dest);
      }
      tracks.push(...dest.stream.getAudioTracks());
    }

    this.stream = new MediaStream(tracks);
    this.mimeType = pickMimeType();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 128_000
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
  }

  start() {
    this.chunks = [];
    this.recorder.start(1000); // gather a chunk every second
  }

  pause() {
    if (this.recorder.state === 'recording') this.recorder.pause();
  }

  resume() {
    if (this.recorder.state === 'paused') this.recorder.resume();
  }

  get state() {
    return this.recorder.state;
  }

  /** @returns {Promise<Blob>} */
  stop() {
    return new Promise((resolve, reject) => {
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
        if (this.audioCtx) this.audioCtx.close();
        resolve(blob);
      };
      this.recorder.onerror = (e) => reject(e.error || new Error('MediaRecorder error'));
      if (this.recorder.state === 'inactive') {
        this.recorder.onstop();
      } else {
        this.recorder.stop();
      }
    });
  }
}
