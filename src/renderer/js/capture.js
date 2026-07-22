// capture.js — acquiring screen, webcam and microphone streams.

/**
 * Ask for a throwaway cam+mic stream once so enumerateDevices() returns
 * labels. Failure is fine (user may deny one or both).
 */
export async function primeDevicePermissions() {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {
    /* labels may stay generic; app still works */
  }
}

export async function listDevices() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    cameras: devices.filter((d) => d.kind === 'videoinput'),
    microphones: devices.filter((d) => d.kind === 'audioinput')
  };
}

/**
 * The main process routes this to the source chosen via window.api.setSource.
 * `withSystemAudio` must match what was passed to setSource.
 */
export async function getScreenStream(withSystemAudio) {
  return navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 } },
    audio: Boolean(withSystemAudio)
  });
}

export async function getWebcamStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 }
    }
  });
}

export async function getMicStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true
    }
  });
}

export function stopStream(stream) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
}
