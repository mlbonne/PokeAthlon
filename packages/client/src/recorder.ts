import { Muxer, StreamTarget } from 'mp4-muxer';

/**
 * In-page frame capture for match recordings (record mode only).
 *
 * Screenshots of a headless browser lag behind when its compositor falls behind, so instead we
 * capture inside the page: right after each render we copy the WebGL canvas, paint the HTML HUD
 * on top with Canvas 2D, and encode the frame with WebCodecs (H.264). mp4-muxer streams the file
 * out through `write(base64, position)` (provided by the recorder script).
 */
export class FrameRecorder {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly encoder: VideoEncoder;
  private readonly muxer: Muxer<StreamTarget>;
  private frame = 0;
  private error = '';

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly fps: number,
    write: (b64: string, position: number) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.muxer = new Muxer({
      target: new StreamTarget({ onData: (data, position) => write(toB64(data), position), chunked: true }),
      video: { codec: 'avc', width, height, frameRate: fps },
      fastStart: false,
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer.addVideoChunk(chunk, meta),
      error: (e) => (this.error = String(e)),
    });
    this.encoder.configure({ codec: 'avc1.640028', width, height, bitrate: 5_000_000, framerate: fps, avc: { format: 'avc' } });
  }

  /** Must be called in the same task as `renderer.render` (the WebGL buffer is only valid until then). */
  async capture(gl: HTMLCanvasElement, hud: HTMLElement): Promise<void> {
    if (this.error) throw new Error(this.error);
    const ctx = this.ctx;
    ctx.globalAlpha = 1;
    ctx.drawImage(gl, 0, 0, this.width, this.height);
    paintHud(ctx, hud, this.width / window.innerWidth);
    const frame = new VideoFrame(this.canvas, {
      timestamp: Math.round((this.frame * 1e6) / this.fps),
      duration: Math.round(1e6 / this.fps),
    });
    this.encoder.encode(frame, { keyFrame: this.frame % (this.fps * 2) === 0 });
    frame.close();
    this.frame++;
    while (this.encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
  }

  async finish(): Promise<number> {
    await this.encoder.flush();
    this.muxer.finalize();
    return this.frame;
  }
}

function toB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

const SKIP = new Set(['help', 'debug']);
const transparent = (c: string) => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);

/** Paint the HUD's visible elements (boxes, text, images, bars) onto a 2D context. */
function paintHud(ctx: CanvasRenderingContext2D, root: HTMLElement, scale: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  for (const child of Array.from(root.children)) paintEl(ctx, child as HTMLElement, 1);
  ctx.restore();
}

function paintEl(ctx: CanvasRenderingContext2D, el: HTMLElement, parentAlpha: number): void {
  if (SKIP.has(el.id) || el.classList.contains('abilities')) return;
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return;
  const alpha = parentAlpha * Number(cs.opacity || 1);
  if (alpha <= 0.01) return;
  const r = el.getBoundingClientRect();

  ctx.globalAlpha = alpha;
  const radius = parseFloat(cs.borderTopLeftRadius) || 0;
  // Energy pips use a CSS gradient driven by --f; draw them explicitly.
  const f = cs.getPropertyValue('--f');
  if (el.tagName === 'I' && f !== '') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, r.left, r.top, r.width, r.height, radius);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    roundRect(ctx, r.left, r.top, r.width * Math.max(0, Math.min(1, Number(f))), r.height, radius);
    ctx.fill();
  } else if (!transparent(cs.backgroundColor)) {
    ctx.fillStyle = cs.backgroundColor;
    roundRect(ctx, r.left, r.top, r.width, r.height, radius);
    ctx.fill();
  }
  const bw = parseFloat(cs.borderTopWidth) || 0;
  if (bw > 0 && !transparent(cs.borderTopColor)) {
    ctx.lineWidth = bw;
    ctx.strokeStyle = cs.borderTopColor;
    roundRect(ctx, r.left + bw / 2, r.top + bw / 2, r.width - bw, r.height - bw, radius);
    ctx.stroke();
  }
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
    ctx.imageSmoothingEnabled = cs.imageRendering !== 'pixelated';
    ctx.drawImage(el, r.left, r.top, r.width, r.height);
  }

  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) paintEl(ctx, node as HTMLElement, alpha);
    else if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim()) paintText(ctx, node as Text, cs, alpha);
  }
}

function paintText(ctx: CanvasRenderingContext2D, node: Text, cs: CSSStyleDeclaration, alpha: number): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const rects = Array.from(range.getClientRects()).filter((q) => q.width > 0);
  if (!rects.length) return;
  // Account for CSS transforms (e.g. the banner's scale) via the rendered size of the text.
  const lines = (node.textContent ?? '').split('\n').filter((l, i, all) => l.trim() || i < all.length - 1);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = cs.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const size = parseFloat(cs.fontSize);
  if (cs.textShadow && cs.textShadow !== 'none') {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowOffsetY = Math.max(1, size / 14);
    ctx.shadowBlur = 2;
  }
  rects.forEach((q, i) => {
    const text = (rects.length === lines.length ? lines[i] : i === 0 ? node.textContent : '') ?? '';
    if (!text.trim()) return;
    const scale = q.height / (parseFloat(cs.lineHeight) || size * 1.25);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${size * (Number.isFinite(scale) && scale > 0.5 ? Math.min(scale, 2) : 1)}px ${cs.fontFamily}`;
    ctx.fillText(text.replace(/\s+$/, ''), q.left, q.top + q.height / 2);
  });
  ctx.shadowColor = 'transparent';
  ctx.shadowOffsetY = 0;
  ctx.shadowBlur = 0;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w), Math.max(0, h), rr);
}
