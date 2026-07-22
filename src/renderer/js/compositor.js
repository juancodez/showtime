// compositor.js — draws screen + circular webcam bubble onto a canvas
// in real time, and handles drag / resize of the bubble on the preview.

export class Compositor {
  /**
   * @param {HTMLCanvasElement} canvas visible preview canvas; also the
   *        surface that gets recorded via captureStream().
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.screenVideo = null;
    this.webcamVideo = null;
    this.running = false;
    this._interval = 0;

    // Bubble geometry, normalized to canvas size so it survives
    // resolution changes. cx/cy = center, r = radius (fraction of height).
    this.bubble = { cx: 0.86, cy: 0.82, r: 0.14, visible: true };

    this._drag = null; // { mode: 'move'|'resize', dx, dy }
    this._attachInteraction();
  }

  setScreenVideo(videoEl) {
    this.screenVideo = videoEl;
    this._fitCanvasToScreen();
  }

  setWebcamVideo(videoEl) {
    this.webcamVideo = videoEl;
  }

  setBubbleVisible(visible) {
    this.bubble.visible = visible;
  }

  setBubbleSize(fraction) {
    this.bubble.r = Math.min(0.4, Math.max(0.05, fraction));
  }

  _fitCanvasToScreen() {
    const track = this.screenVideo?.srcObject?.getVideoTracks?.()[0];
    const s = track ? track.getSettings() : null;
    const w = s?.width || this.screenVideo?.videoWidth || 1920;
    const h = s?.height || this.screenVideo?.videoHeight || 1080;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  start(fps = 30) {
    if (this.running) return;
    this.running = true;
    // setInterval (not rAF): rAF stops when the window is hidden, and the
    // main window hides itself while recording. Requires the BrowserWindow
    // to be created with backgroundThrottling: false.
    this._interval = setInterval(() => this._draw(), Math.round(1000 / fps));
  }

  stop() {
    this.running = false;
    clearInterval(this._interval);
  }

  getStream(fps = 30) {
    return this.canvas.captureStream(fps);
  }

  _draw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (this.screenVideo && this.screenVideo.readyState >= 2) {
      // If capture resolution changed mid-stream (e.g. window resized), refit.
      const vw = this.screenVideo.videoWidth;
      const vh = this.screenVideo.videoHeight;
      if (vw && vh && (vw !== W || vh !== H)) {
        this._fitCanvasToScreen();
        return;
      }
      ctx.drawImage(this.screenVideo, 0, 0, W, H);
    }

    if (this.bubble.visible && this.webcamVideo && this.webcamVideo.readyState >= 2) {
      this._drawBubble(W, H);
    }
  }

  _drawBubble(W, H) {
    const { ctx } = this;
    const r = this.bubble.r * H;
    const cx = this.bubble.cx * W;
    const cy = this.bubble.cy * H;
    const v = this.webcamVideo;

    // Center-crop the largest square from the webcam feed (cover fit).
    const side = Math.min(v.videoWidth, v.videoHeight);
    const sx = (v.videoWidth - side) / 2;
    const sy = (v.videoHeight - side) / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(v, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Border ring.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, r * 0.05);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  // --- pointer interaction on the preview canvas -----------------------

  _canvasPoint(ev) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((ev.clientY - rect.top) / rect.height) * this.canvas.height
    };
  }

  _hitBubble(p) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = this.bubble.cx * W;
    const cy = this.bubble.cy * H;
    const r = this.bubble.r * H;
    const dist = Math.hypot(p.x - cx, p.y - cy);
    if (dist > r) return null;
    // Outer 20% of the radius acts as a resize handle.
    return dist > r * 0.8 ? 'resize' : 'move';
  }

  _attachInteraction() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (ev) => {
      if (!this.bubble.visible) return;
      const p = this._canvasPoint(ev);
      const mode = this._hitBubble(p);
      if (!mode) return;
      this._drag = { mode, start: p, startBubble: { ...this.bubble } };
      c.setPointerCapture(ev.pointerId);
    });

    c.addEventListener('pointermove', (ev) => {
      const p = this._canvasPoint(ev);
      if (!this._drag) {
        const hit = this.bubble.visible ? this._hitBubble(p) : null;
        c.style.cursor = hit === 'move' ? 'grab' : hit === 'resize' ? 'nwse-resize' : 'default';
        return;
      }
      const W = this.canvas.width;
      const H = this.canvas.height;
      const { mode, start, startBubble } = this._drag;
      if (mode === 'move') {
        this.bubble.cx = startBubble.cx + (p.x - start.x) / W;
        this.bubble.cy = startBubble.cy + (p.y - start.y) / H;
        const rW = (startBubble.r * H) / W;
        this.bubble.cx = Math.min(1 - rW, Math.max(rW, this.bubble.cx));
        this.bubble.cy = Math.min(1 - startBubble.r, Math.max(startBubble.r, this.bubble.cy));
      } else {
        const cx = startBubble.cx * W;
        const cy = startBubble.cy * H;
        this.setBubbleSize(Math.hypot(p.x - cx, p.y - cy) / H);
      }
    });

    const end = (ev) => {
      if (this._drag) {
        this._drag = null;
        try { c.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    // Scroll wheel over the bubble resizes it.
    c.addEventListener('wheel', (ev) => {
      if (!this.bubble.visible) return;
      const p = this._canvasPoint(ev);
      if (!this._hitBubble(p)) return;
      ev.preventDefault();
      this.setBubbleSize(this.bubble.r * (ev.deltaY < 0 ? 1.08 : 0.92));
    }, { passive: false });
  }
}
