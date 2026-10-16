import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import type { RealtimeEvent, WhiteboardOp } from '@/types/db';
import type { useRoomRealtime } from '@/hooks/useRoomRealtime';

type Tool = 'pen' | 'highlighter' | 'eraser' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'pan';

interface View {
  scale: number;
  x: number;
  y: number;
}

interface RemoteCursor {
  x: number;
  y: number;
  name: string;
  at: number;
}

const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: '✏️' },
  { id: 'highlighter', label: 'Highlighter', icon: '🖍' },
  { id: 'eraser', label: 'Eraser', icon: '🧽' },
  { id: 'rect', label: 'Rectangle', icon: '▭' },
  { id: 'ellipse', label: 'Ellipse', icon: '◯' },
  { id: 'line', label: 'Line', icon: '╱' },
  { id: 'arrow', label: 'Arrow', icon: '➔' },
  { id: 'text', label: 'Text', icon: 'T' },
  { id: 'pan', label: 'Pan', icon: '✋' },
];

const COLORS = ['#e9ecfc', '#7a86ff', '#48d69c', '#ff6a80', '#ffd166', '#5ec8ff'];

/** Private bucket that holds room PDFs and whiteboard images. */
const BUCKET = 'room-files';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Apply the pan/zoom transform (in device pixels) to a 2D context. */
function applyTransform(ctx: CanvasRenderingContext2D, view: View, dpr: number) {
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);
}

/** Draw a single operation in world coordinates. */
function drawOp(
  ctx: CanvasRenderingContext2D,
  op: WhiteboardOp,
  images?: Map<string, HTMLImageElement>,
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (op.kind) {
    case 'stroke': {
      ctx.globalAlpha = op.tool === 'highlighter' ? 0.3 : 1;
      ctx.globalCompositeOperation = op.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = op.tool === 'eraser' ? '#000' : op.color;
      ctx.lineWidth = op.tool === 'eraser' ? op.width * 2.5 : op.width;
      ctx.beginPath();
      op.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      if (op.points.length === 1) ctx.lineTo(op.points[0][0] + 0.01, op.points[0][1]);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'shape': {
      ctx.strokeStyle = op.color;
      ctx.lineWidth = op.width;
      const [x1, y1] = op.from;
      const [x2, y2] = op.to;
      ctx.beginPath();
      if (op.shape === 'rect') {
        ctx.rect(x1, y1, x2 - x1, y2 - y1);
      } else if (op.shape === 'ellipse') {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        ctx.ellipse(cx, cy, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      } else if (op.shape === 'line') {
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      } else {
        // arrow: line + head
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const head = 12 + op.width;
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      ctx.fillStyle = op.color;
      ctx.font = `${op.size}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(op.text, op.x, op.y);
      break;
    }
    case 'formula': {
      // Rendered as its LaTeX source on canvas. For a fully typeset result the
      // Math tab previews the same expression with MathLive. See LIMITATIONS.md.
      ctx.fillStyle = '#e9ecfc';
      ctx.font = '18px "STIX Two Math", "Cambria Math", serif';
      ctx.textBaseline = 'top';
      ctx.fillText(op.latex, op.x, op.y);
      break;
    }
    case 'image': {
      const img = images?.get(op.path);
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, op.x, op.y, op.width, op.height);
      }
      break;
    }
    case 'clear':
      // Handled during full re-render.
      break;
  }
}

export default function Whiteboard({
  roomId,
  realtime,
  canEdit,
}: {
  roomId: string;
  realtime: ReturnType<typeof useRoomRealtime>;
  canEdit: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  // The grid is static for a given view, so it is rendered once into its own
  // layer and blitted — instead of redrawing every dot on every pointer move.
  const gridCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafPaintRef = useRef<number | null>(null);
  const rafRenderRef = useRef<number | null>(null);

  const opsRef = useRef<WhiteboardOp[]>([]);
  const redoRef = useRef<WhiteboardOp[]>([]);
  const liveRef = useRef<WhiteboardOp | null>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<[number, number]>([0, 0]);

  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  // Cap the backing-store resolution. Phones report devicePixelRatio 3, which
  // makes a very large canvas that is expensive to clear and blit every frame.
  const dpr = useMemo(() => {
    const raw = window.devicePixelRatio || 1;
    const cap = window.innerWidth <= 820 ? 1.5 : 2;
    return Math.min(raw, cap);
  }, []);

  const [, bump] = useReducer((n: number) => n + 1, 0);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [grid, setGrid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  // Remote cursors are drawn imperatively onto the canvas, so they live in a ref
  // rather than React state — an incoming cursor must not trigger a re-render.
  const cursorsRef = useRef<Record<string, RemoteCursor>>({});

  // Whiteboard images live in Supabase Storage; an op only stores the object
  // path. Loaded bitmaps and resolved signed URLs are cached, so a repaint
  // never re-downloads anything.
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const signedUrls = useRef<Map<string, string>>(new Map());
  const loadingImages = useRef<Set<string>>(new Set());
  const imageInputRef = useRef<HTMLInputElement>(null);

  const lastCursorSent = useRef(0);
  // Set whenever the scene changes, so autosave knows there is something to write.
  const dirtyRef = useRef(false);

  /* ----------------------------- rendering ----------------------------- */

  /** Render the static grid into its own layer (only when the view changes). */
  const renderGrid = useCallback(() => {
    const gc = gridCanvasRef.current;
    if (!gc) return;
    const gctx = gc.getContext('2d');
    if (!gctx) return;
    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.clearRect(0, 0, gc.width, gc.height);
    if (grid) drawGrid(gctx, gc, viewRef.current, dpr);
  }, [grid, dpr]);

  const rerender = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const octx = off.getContext('2d');
    if (!octx) return;

    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, off.width, off.height);
    applyTransform(octx, viewRef.current, dpr);

    for (const op of opsRef.current) {
      if (op.kind === 'clear') {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, off.width, off.height);
        applyTransform(octx, viewRef.current, dpr);
      } else {
        drawOp(octx, op, imageCache.current);
      }
    }
    renderGrid();
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr, renderGrid]);

  /** Blit the committed layers and overlay the in-progress op + cursors. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gc = gridCanvasRef.current;
    if (grid && gc) ctx.drawImage(gc, 0, 0);
    ctx.drawImage(off, 0, 0);

    applyTransform(ctx, viewRef.current, dpr);
    if (liveRef.current && liveRef.current.kind !== 'clear')
      drawOp(ctx, liveRef.current, imageCache.current);

    // Remote cursors, drawn in world space so they track pan/zoom.
    const now = Date.now();
    for (const [, c] of Object.entries(cursorsRef.current)) {
      if (now - c.at > 8000) continue;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = c.x * viewRef.current.scale * dpr + viewRef.current.x * dpr;
      const sy = c.y * viewRef.current.scale * dpr + viewRef.current.y * dpr;
      ctx.fillStyle = '#7a86ff';
      ctx.beginPath();
      ctx.arc(sx, sy, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e9ecfc';
      ctx.font = `${11 * dpr}px Inter, sans-serif`;
      ctx.fillText(c.name, sx + 8 * dpr, sy + 4 * dpr);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [grid, dpr]);

  /** Coalesce repaint requests so drawing costs at most one repaint per frame. */
  const schedulePaint = useCallback(() => {
    if (rafPaintRef.current !== null) return;
    rafPaintRef.current = window.requestAnimationFrame(() => {
      rafPaintRef.current = null;
      paint();
    });
  }, [paint]);

  /** Same, for full re-bakes (pan/zoom), which are the most expensive path. */
  const scheduleRerender = useCallback(() => {
    if (rafRenderRef.current !== null) return;
    rafRenderRef.current = window.requestAnimationFrame(() => {
      rafRenderRef.current = null;
      rerender();
    });
  }, [rerender]);

  /** Load an image op's bitmap (resolving a signed URL if needed), then repaint. */
  const ensureImage = useCallback(
    async (path: string) => {
      if (imageCache.current.has(path) || loadingImages.current.has(path)) return;
      loadingImages.current.add(path);
      try {
        let url = signedUrls.current.get(path);
        if (!url) {
          const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
          if (error || !data?.signedUrl) return;
          url = data.signedUrl;
          signedUrls.current.set(path, url);
        }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image load failed'));
          img.src = url as string;
        });
        imageCache.current.set(path, img);
        rerender();
      } catch {
        // Leave the op unrendered; a later repaint trigger will retry.
      } finally {
        loadingImages.current.delete(path);
      }
    },
    [rerender],
  );

  /** Commit an op locally and broadcast it. */
  const commit = useCallback(
    (op: WhiteboardOp) => {
      opsRef.current.push(op);
      redoRef.current = [];
      const off = offscreenRef.current;
      const octx = off?.getContext('2d');
      if (off && octx) {
        if (op.kind === 'clear') {
          rerender();
        } else {
          applyTransform(octx, viewRef.current, dpr);
          drawOp(octx, op, imageCache.current);
          paint();
        }
      }
      realtime.broadcast({ type: 'whiteboard:op', op, sender: '' });
      dirtyRef.current = true;
      bump();
    },
    [realtime, rerender, paint, dpr],
  );

  /** Apply an op that arrived from another participant. */
  const applyRemote = useCallback(
    (op: WhiteboardOp) => {
      if (op.kind === 'clear') {
        opsRef.current = [];
        redoRef.current = [];
        rerender();
        bump();
        return;
      }
      opsRef.current.push(op);
      if (op.kind === 'image') void ensureImage(op.path);
      const off = offscreenRef.current;
      const octx = off?.getContext('2d');
      if (off && octx) {
        applyTransform(octx, viewRef.current, dpr);
        drawOp(octx, op, imageCache.current);
        paint();
      }
      dirtyRef.current = true;
      bump();
    },
    [rerender, paint, dpr, ensureImage],
  );

  /* --------------------------- setup / sizing --------------------------- */

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    // Skip while the tab is hidden (display:none yields a zero-size rect) so we
    // don't clobber the canvas — the ResizeObserver fires again when it returns.
    if (rect.width < 1 || rect.height < 1) return;
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(320, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    offscreenRef.current.width = canvas.width;
    offscreenRef.current.height = canvas.height;

    if (!gridCanvasRef.current) gridCanvasRef.current = document.createElement('canvas');
    gridCanvasRef.current.width = canvas.width;
    gridCanvasRef.current.height = canvas.height;

    rerender();
  }, [dpr, rerender]);

  // Load saved snapshot once.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('whiteboard_snapshots')
        .select('data')
        .eq('room_id', roomId)
        .maybeSingle();
      if (!active) return;
      const saved = (data?.data as { ops?: WhiteboardOp[] } | undefined)?.ops;
      if (Array.isArray(saved) && saved.length) {
        opsRef.current = saved;
        saved.forEach((op) => {
          if (op.kind === 'image') void ensureImage(op.path);
        });
        rerender();
      }
    })();
    return () => {
      active = false;
    };
  }, [roomId, rerender, ensureImage]);

  useEffect(() => {
    resize();
    const ro = new ResizeObserver(resize);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('orientationchange', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', resize);
    };
  }, [resize]);

  // Re-bake the cached grid layer when the grid is toggled.
  useEffect(() => {
    renderGrid();
    paint();
  }, [grid, renderGrid, paint]);

  // Inbound realtime events for the board.
  useEffect(() => {
    return realtime.subscribe((e: RealtimeEvent) => {
      if (e.type === 'whiteboard:op') applyRemote(e.op);
      else if (e.type === 'whiteboard:snapshot') {
        const ops = (e.data as { ops?: WhiteboardOp[] })?.ops ?? [];
        opsRef.current = ops;
        ops.forEach((op) => {
          if (op.kind === 'image') void ensureImage(op.path);
        });
        rerender();
        bump();
      } else if (e.type === 'cursor') {
        cursorsRef.current = {
          ...cursorsRef.current,
          [e.sender]: { x: e.x, y: e.y, name: e.sender || 'Peer', at: Date.now() },
        };
        schedulePaint();
      }
    });
  }, [realtime, applyRemote, rerender, schedulePaint, ensureImage]);

  // Repaint periodically only while remote cursors are on screen (so they fade
  // out) — an idle board costs nothing.
  useEffect(() => {
    const t = setInterval(() => {
      if (Object.keys(cursorsRef.current).length > 0) paint();
    }, 3000);
    return () => clearInterval(t);
  }, [paint]);

  /* ----------------------------- pointers ------------------------------ */

  function toWorld(e: ReactPointerEvent) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const v = viewRef.current;
    return [(sx - v.x) / v.scale, (sy - v.y) / v.scale] as [number, number];
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (!canEdit && tool !== 'pan') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = toWorld(e);

    if (tool === 'pan' || e.button === 1) {
      drawingRef.current = true;
      startRef.current = [e.clientX, e.clientY];
      return;
    }

    if (tool === 'text') {
      const text = window.prompt('Text to add:');
      if (text && text.trim()) {
        commit({ kind: 'text', x, y, text: text.trim(), color, size: 18 });
      }
      return;
    }

    drawingRef.current = true;
    startRef.current = [x, y];

    if (tool === 'pen' || tool === 'highlighter' || tool === 'eraser') {
      liveRef.current = { kind: 'stroke', tool, color, width, points: [[x, y]] };
    } else {
      liveRef.current = { kind: 'shape', shape: tool, color, width, from: [x, y], to: [x, y] };
    }
    paint();
  }

  function onPointerMove(e: ReactPointerEvent) {
    const [x, y] = toWorld(e);

    // Broadcast cursor position (throttled) so others can see where we are.
    const now = Date.now();
    if (now - lastCursorSent.current > 120) {
      lastCursorSent.current = now;
      realtime.broadcast({ type: 'cursor', x, y, sender: '' });
    }

    if (!drawingRef.current) return;

    if (tool === 'pan') {
      const v = viewRef.current;
      v.x += e.clientX - startRef.current[0];
      v.y += e.clientY - startRef.current[1];
      startRef.current = [e.clientX, e.clientY];
      // Panning re-bakes the layer, so coalesce it to one per frame.
      scheduleRerender();
      return;
    }

    if (!liveRef.current) return;
    if (liveRef.current.kind === 'stroke') {
      liveRef.current.points.push([x, y]);
    } else if (liveRef.current.kind === 'shape') {
      liveRef.current.to = [x, y];
    }
    schedulePaint();
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (liveRef.current && liveRef.current.kind !== 'clear') {
      const op = liveRef.current;
      // Skip empty/zero-length shapes.
      if (op.kind === 'stroke' ? op.points.length > 1 : true) commit(op);
    }
    liveRef.current = null;
    paint();
  }

  function onWheel(e: ReactWheelEvent) {
    e.preventDefault();
    const v = viewRef.current;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(4, Math.max(0.25, v.scale * factor));
    // Keep the point under the cursor stationary.
    v.x = sx - (sx - v.x) * (newScale / v.scale);
    v.y = sy - (sy - v.y) * (newScale / v.scale);
    v.scale = newScale;
    rerender();
  }

  /* ------------------------------ actions ------------------------------ */

  function undo() {
    const op = opsRef.current.pop();
    if (!op) return;
    redoRef.current.push(op);
    // Broadcast a full snapshot so peers converge (undo is not trivially
    // expressible as an incremental op).
    rerender();
    dirtyRef.current = true;
    bump();
    realtime.broadcast({ type: 'whiteboard:snapshot', data: { ops: opsRef.current }, sender: '' });
  }

  function redo() {
    const op = redoRef.current.pop();
    if (!op) return;
    opsRef.current.push(op);
    if (op.kind === 'clear') rerender();
    else {
      const octx = offscreenRef.current?.getContext('2d');
      if (octx) {
        applyTransform(octx, viewRef.current, dpr);
        drawOp(octx, op, imageCache.current);
        paint();
      }
      if (op.kind === 'image') void ensureImage(op.path);
    }
    dirtyRef.current = true;
    bump();
    realtime.broadcast({ type: 'whiteboard:snapshot', data: { ops: opsRef.current }, sender: '' });
  }

  function clearBoard() {
    if (!window.confirm('Clear the whiteboard for everyone?')) return;
    opsRef.current = [];
    redoRef.current = [];
    rerender();
    dirtyRef.current = true;
    bump();
    realtime.broadcast({ type: 'whiteboard:op', op: { kind: 'clear' }, sender: '' });
  }

  function zoom(delta: number) {
    const v = viewRef.current;
    v.scale = Math.min(4, Math.max(0.25, v.scale + delta));
    rerender();
  }

  function resetView() {
    viewRef.current = { scale: 1, x: 0, y: 0 };
    rerender();
  }

  /** Write the current scene to the room's snapshot row. */
  const persistSnapshot = useCallback(async (): Promise<boolean> => {
    const payload = { ops: opsRef.current };
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('whiteboard_snapshots').upsert({
      room_id: roomId,
      data: payload,
      updated_by: auth.user?.id,
      updated_at: new Date().toISOString(),
    });
    return !error;
  }, [roomId]);

  /** Explicit Save: persists and tells everyone else in the room. */
  async function save() {
    setSaving(true);
    setStatusMsg(null);
    const ok = await persistSnapshot();
    setSaving(false);
    setStatusMsg(ok ? 'Whiteboard saved.' : 'Could not save the whiteboard.');
    if (ok) {
      realtime.broadcast({ type: 'whiteboard:snapshot', data: { ops: opsRef.current }, sender: '' });
    }
    setTimeout(() => setStatusMsg(null), 2500);
  }

  // Autosave: persist a few seconds after the last change, so the board survives
  // a refresh, a navigation or a tab switch even if Save is never pressed.
  useEffect(() => {
    if (!canEdit) return;
    const t = setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      void persistSnapshot();
    }, 8000);
    return () => clearInterval(t);
  }, [canEdit, persistSnapshot]);

  /* ---------------------------- image import --------------------------- */

  /** Shrink very large photos before upload so storage and rendering stay cheap. */
  async function prepareImage(file: File): Promise<{ blob: Blob; mime: string }> {
    const MAX_DIM = 1600;
    const fallback = { blob: file, mime: file.type || 'image/png' };
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
      if (scale >= 1 && file.size <= 1_200_000) return fallback;

      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return fallback;
      ctx.drawImage(bitmap, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      return blob ? { blob, mime: 'image/jpeg' } : fallback;
    } catch {
      return fallback;
    }
  }

  /** Upload an image and drop it onto the board, centred in the current view. */
  async function insertImage(file: File) {
    if (!canEdit) return;
    setStatusMsg(null);

    if (!file.type.startsWith('image/')) {
      setStatusMsg('That file is not an image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatusMsg('Image is larger than 12 MB.');
      return;
    }

    setImageBusy(true);
    try {
      const { blob, mime } = await prepareImage(file);
      const ext = mime === 'image/jpeg' ? 'jpg' : file.name.split('.').pop() || 'png';
      const path = `${roomId}/${crypto.randomUUID()}-img.${ext}`;

      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, blob, { contentType: mime, upsert: false });
      if (upErr) throw upErr;

      const { data: auth } = await supabase.auth.getUser();
      await supabase.from('files').insert({
        room_id: roomId,
        uploader_id: auth.user?.id,
        storage_path: path,
        name: file.name,
        mime,
        size_bytes: blob.size,
      });

      // Render from the local blob straight away; peers fetch a signed URL.
      const localUrl = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('decode failed'));
        img.src = localUrl;
      });
      imageCache.current.set(path, img);
      signedUrls.current.set(path, localUrl);

      // Place it centred, fitted to ~70% of the visible area.
      const rect = canvasRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      const worldW = (rect?.width ?? 800) / v.scale;
      const worldH = (rect?.height ?? 600) / v.scale;
      const worldLeft = -v.x / v.scale;
      const worldTop = -v.y / v.scale;
      const fit = Math.min(
        (worldW * 0.7) / img.naturalWidth,
        (worldH * 0.7) / img.naturalHeight,
        1,
      );
      const width = img.naturalWidth * fit;
      const height = img.naturalHeight * fit;
      const x = worldLeft + (worldW - width) / 2;
      const y = worldTop + (worldH - height) / 2;

      commit({ kind: 'image', x, y, width, height, path });
      setStatusMsg('Image added — draw over it with the pen.');
    } catch (e) {
      setStatusMsg(`Could not add image: ${(e as Error).message}`);
    } finally {
      setImageBusy(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
      setTimeout(() => setStatusMsg(null), 3000);
    }
  }

  /* ------------------------------- view -------------------------------- */

  const activeCursor = tool === 'pan' ? 'grab' : 'crosshair';

  return (
    <GlassCard className="flex flex-col gap-3 p-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              title={t.label}
              aria-label={t.label}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              className={cn(
                'focus-ring pill grid h-9 w-9 place-items-center text-sm',
                tool === t.id ? 'bg-accent/30 text-ink' : 'glass-subtle text-soft hover:text-ink',
              )}
            >
              <span aria-hidden="true">{t.icon}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              aria-label={`Colour ${c}`}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-transform hover:scale-110',
                color === c ? 'border-ink' : 'border-transparent',
              )}
              style={{ background: c }}
            />
          ))}
        </div>

        <label className="flex items-center gap-2 text-xs text-soft">
          Size
          <input
            type="range"
            min={1}
            max={24}
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-24 accent-accent"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <GlassButton size="sm" variant="subtle" onClick={undo}>
            Undo
          </GlassButton>
          <GlassButton size="sm" variant="subtle" onClick={redo}>
            Redo
          </GlassButton>
          <GlassButton size="sm" variant="subtle" onClick={() => setGrid((g) => !g)}>
            {grid ? 'Grid: on' : 'Grid: off'}
          </GlassButton>
          <GlassButton size="sm" variant="subtle" onClick={() => zoom(0.1)}>
            +
          </GlassButton>
          <GlassButton size="sm" variant="subtle" onClick={() => zoom(-0.1)}>
            −
          </GlassButton>
          <GlassButton size="sm" variant="subtle" onClick={resetView}>
            Reset view
          </GlassButton>
          {canEdit && (
            <GlassButton
              size="sm"
              variant="subtle"
              loading={imageBusy}
              onClick={() => imageInputRef.current?.click()}
            >
              Add image
            </GlassButton>
          )}
          {canEdit && (
            <GlassButton size="sm" variant="danger" onClick={clearBoard}>
              Clear
            </GlassButton>
          )}
          <GlassButton size="sm" loading={saving} onClick={save}>
            Save
          </GlassButton>
        </div>
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void insertImage(f);
        }}
      />

      {statusMsg && <p className="text-xs text-soft">{statusMsg}</p>}

      {/* Canvas */}
      <div
        ref={wrapRef}
        className="relative h-[60vh] min-h-[360px] w-full overflow-hidden rounded-2xl glass-subtle"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onWheel={onWheel}
          style={{ touchAction: 'none', cursor: activeCursor }}
          className="absolute inset-0"
        />
        {!canEdit && (
          <span className="absolute left-3 top-3 rounded-full bg-black/40 px-3 py-1 text-xs text-white">
            View only
          </span>
        )}
      </div>
    </GlassCard>
  );
}

/** Faint dotted grid drawn in screen space, scaled by zoom. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  view: View,
  dpr: number,
) {
  const step = 32 * view.scale * dpr;
  if (step < 8) return;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  const startX = ((view.x * dpr) % step + step) % step;
  const startY = ((view.y * dpr) % step + step) % step;
  for (let x = startX; x < canvas.width; x += step) {
    for (let y = startY; y < canvas.height; y += step) {
      ctx.fillRect(x, y, dpr, dpr);
    }
  }
}
