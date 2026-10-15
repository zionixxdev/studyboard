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

/** Apply the pan/zoom transform (in device pixels) to a 2D context. */
function applyTransform(ctx: CanvasRenderingContext2D, view: View, dpr: number) {
  ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.x * dpr, view.y * dpr);
}

/** Draw a single operation in world coordinates. */
function drawOp(ctx: CanvasRenderingContext2D, op: WhiteboardOp) {
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
  const wrapRef = useRef<HTMLDivElement>(null);

  const opsRef = useRef<WhiteboardOp[]>([]);
  const redoRef = useRef<WhiteboardOp[]>([]);
  const liveRef = useRef<WhiteboardOp | null>(null);
  const drawingRef = useRef(false);
  const startRef = useRef<[number, number]>([0, 0]);

  const viewRef = useRef<View>({ scale: 1, x: 0, y: 0 });
  const dpr = useMemo(() => Math.min(window.devicePixelRatio || 1, 2), []);

  const [, bump] = useReducer((n: number) => n + 1, 0);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [grid, setGrid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});

  const lastCursorSent = useRef(0);

  /* ----------------------------- rendering ----------------------------- */

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
        drawOp(octx, op);
      }
    }
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dpr]);

  /** Blit the committed layer and overlay the in-progress op + cursors. */
  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offscreenRef.current;
    if (!canvas || !off) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (grid) {
      drawGrid(ctx, canvas, viewRef.current, dpr);
    }
    ctx.drawImage(off, 0, 0);

    applyTransform(ctx, viewRef.current, dpr);
    if (liveRef.current && liveRef.current.kind !== 'clear') drawOp(ctx, liveRef.current);

    // Remote cursors, drawn in world space so they track pan/zoom.
    const now = Date.now();
    for (const [, c] of Object.entries(cursors)) {
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
  }, [grid, cursors, dpr]);

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
          drawOp(octx, op);
          paint();
        }
      }
      realtime.broadcast({ type: 'whiteboard:op', op, sender: '' });
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
      const off = offscreenRef.current;
      const octx = off?.getContext('2d');
      if (off && octx) {
        applyTransform(octx, viewRef.current, dpr);
        drawOp(octx, op);
        paint();
      }
      bump();
    },
    [rerender, paint, dpr],
  );

  /* --------------------------- setup / sizing --------------------------- */

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(320, Math.floor(rect.height));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    offscreenRef.current.width = canvas.width;
    offscreenRef.current.height = canvas.height;

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
        rerender();
      }
    })();
    return () => {
      active = false;
    };
  }, [roomId, rerender]);

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

  // Inbound realtime events for the board.
  useEffect(() => {
    return realtime.subscribe((e: RealtimeEvent) => {
      if (e.type === 'whiteboard:op') applyRemote(e.op);
      else if (e.type === 'whiteboard:snapshot') {
        opsRef.current = (e.data as { ops?: WhiteboardOp[] })?.ops ?? [];
        rerender();
        bump();
      } else if (e.type === 'cursor') {
        setCursors((prev) => ({
          ...prev,
          [e.sender]: { x: e.x, y: e.y, name: e.sender || 'Peer', at: Date.now() },
        }));
      }
    });
  }, [realtime, applyRemote, rerender]);

  // Repaint cursors periodically so stale ones fade out.
  useEffect(() => {
    const t = setInterval(paint, 2000);
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
    if (now - lastCursorSent.current > 60) {
      lastCursorSent.current = now;
      realtime.broadcast({ type: 'cursor', x, y, sender: '' });
    }

    if (!drawingRef.current) return;

    if (tool === 'pan') {
      const v = viewRef.current;
      v.x += e.clientX - startRef.current[0];
      v.y += e.clientY - startRef.current[1];
      startRef.current = [e.clientX, e.clientY];
      rerender();
      return;
    }

    if (!liveRef.current) return;
    if (liveRef.current.kind === 'stroke') {
      liveRef.current.points.push([x, y]);
    } else if (liveRef.current.kind === 'shape') {
      liveRef.current.to = [x, y];
    }
    paint();
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
        drawOp(octx, op);
        paint();
      }
    }
    bump();
    realtime.broadcast({ type: 'whiteboard:snapshot', data: { ops: opsRef.current }, sender: '' });
  }

  function clearBoard() {
    if (!window.confirm('Clear the whiteboard for everyone?')) return;
    opsRef.current = [];
    redoRef.current = [];
    rerender();
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

  async function save() {
    setSaving(true);
    setStatusMsg(null);
    const payload = { ops: opsRef.current };
    const { data: auth } = await supabase.auth.getUser();
    const { error } = await supabase.from('whiteboard_snapshots').upsert({
      room_id: roomId,
      data: payload,
      updated_by: auth.user?.id,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    setStatusMsg(error ? error.message : 'Whiteboard saved.');
    if (!error) realtime.broadcast({ type: 'whiteboard:snapshot', data: payload, sender: '' });
    setTimeout(() => setStatusMsg(null), 2500);
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
            <GlassButton size="sm" variant="danger" onClick={clearBoard}>
              Clear
            </GlassButton>
          )}
          <GlassButton size="sm" loading={saving} onClick={save}>
            Save
          </GlassButton>
        </div>
      </div>

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
