// trimmer.js — helpers for working with MediaRecorder blobs.
// Actual trimming/conversion happens in the main process via ffmpeg
// (see main.js 'export-recording'); this only fixes the duration quirk.

/**
 * MediaRecorder WebM blobs report duration = Infinity until you seek to
 * the end once. Returns the real duration in seconds.
 */
export function getBlobDuration(videoEl) {
  return new Promise((resolve) => {
    if (Number.isFinite(videoEl.duration)) return resolve(videoEl.duration);
    const onSeeked = () => {
      videoEl.removeEventListener('seeked', onSeeked);
      const d = videoEl.duration;
      videoEl.currentTime = 0;
      resolve(d);
    };
    videoEl.addEventListener('seeked', onSeeked);
    videoEl.currentTime = Number.MAX_SAFE_INTEGER;
  });
}
