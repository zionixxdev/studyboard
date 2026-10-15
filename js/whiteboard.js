// =============================================================================
// Whiteboard engine — HTML Canvas, world-space coordinates, pan/zoom, tools,
// multi-user undo/redo, ephemeral live strokes and remote cursors.
//
// Coordinate model: every object is stored in *world* units on a fixed virtual
// board (WORLD). The camera maps world -> screen, so a board looks identical on
// a phone and a desktop. Nothing about the layout depends on screen size.
//
// Persistence contract (handled by the caller):
//   opts.onCommit(op)   -> persist an add/delete to the database
//   opts.onLive(points) -> broadcast an in-progress stroke (ephemeral)
//   opts.onCursor(pt)   -> broadcast this user's pointer (ephemeral)
// =============================================================================
import { clamp, randomId, throttle } from "./util.js";

export const WORLD = { w: 2600, h: 1700 };

export const PALETTE = [
  "#0f2540", "#0ea5a4", "#dc2626", "#2563eb",
  "#16a34a", "#d97706", "#7c3aed", "#db2777",
];

const LIVE_TTL = 4000;   // ms an in-progress remote stroke stays on screen
const CURSOR_TTL = 12000; // ms a remote cursor stays visible

export class Whiteboard {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.opts = opts;

    this.objects = [];          // committed objects (world space)
    this.byId = new Map();
    this.imgCache = new Map();  // id -> HTMLImageElement

    this.cam = { ox: 0, oy: 0, zoom: 1 };
    this.tool = "pen";
    this.color = PALETTE[0];
    this.width = 3;

    this.drawing = null;        // current local op in progress
    this.panning = null;
    this.pointers = new Map();  // pointerId -> {x,y}
    this.pinch = null;

    this.liveRemote = new Map(); // authorId -> {kind, data, color, width, ts}
    this.cursors = new Map();    // userId -> {x, y, name, color, ts}
    this.selection = null;

    this.undoStack = [];
    this.redoStack = [];
    this.myId = opts.myUserId || null;

    this._dirty = true;
    this._raf = null;
    this._bind();
    this._resize();
    this._loop();
  }

  // ---------------------------------------------------------------- lifecycle
  destroy() {
    cancelAnimationFrame(this._raf);
    this._unbind();
  }

  setMyId(id) { this.myId = id; }

  setTool(tool) { this.tool = tool; this.canvas.style.cursor = tool === "pan" ? "grab" : "crosshair"; }
  setColor(c) { this.color = c; }
  setWidth(w) { this.width = Number(w) || 3; }

  // ------------------------------------------------------------- data loading
  setObjects(objs) {
    this.objects = (objs || []).filter(o => !o.deleted).map(o => this._hydrate(o));
    this.byId = new Map(this.objects.map(o => [o.id, o]));
    this.undoStack = []; this.redoStack = [];
    this._invalidate();
  }

  _hydrate(o) {
    // Accept DB rows ({id, kind, data, author_id, z}) or local objects.
    return {
      id: o.id,
      kind: o.kind,
      data: o.data,
      author: o.author ?? o.author_id ?? null,
      z: o.z ?? 0,
      deleted: false,
    };
  }

  // --------------------------------------------------------------- local ops
  addLocal(obj, { persist = true, pushUndo = true } = {}) {
    if (this.byId.has(obj.id)) return;
    this.objects.push(obj);
    this.byId.set(obj.id, obj);
    if (pushUndo) { this.undoStack.push({ op: "add", obj }); this.redoStack = []; }
    if (persist) this.opts.onCommit?.({ op: "add", obj });
    this._invalidate();
  }

  deleteLocal(id, { persist = true, pushUndo = true } = {}) {
    const obj = this.byId.get(id);
    if (!obj) return;
    this.objects = this.objects.filter(o => o.id !== id);
    this.byId.delete(id);
    this.imgCache.delete(id);
    if (pushUndo) { this.undoStack.push({ op: "delete", obj }); this.redoStack = []; }
    if (persist) this.opts.onCommit?.({ op: "delete", obj });
    this._invalidate();
  }

  undo() {
    const a = this.undoStack.pop();
    if (!a) return;
    if (a.op === "add") {
      this.objects = this.objects.filter(o => o.id !== a.obj.id);
      this.byId.delete(a.obj.id);
      this.opts.onCommit?.({ op: "delete", obj: a.obj });
    } else {
      this.objects.push(a.obj); this.byId.set(a.obj.id, a.obj);
      this.opts.onCommit?.({ op: "add", obj: a.obj });
    }
    this.redoStack.push(a);
    this._invalidate();
  }

  redo() {
    const a = this.redoStack.pop();
    if (!a) return;
    if (a.op === "add") {
      this.objects.push(a.obj); this.byId.set(a.obj.id, a.obj);
      this.opts.onCommit?.({ op: "add", obj: a.obj });
    } else {
      this.objects = this.objects.filter(o => o.id !== a.obj.id);
      this.byId.delete(a.obj.id);
      this.opts.onCommit?.({ op: "delete", obj: a.obj });
    }
    this.undoStack.push(a);
    this._invalidate();
  }

  // -------------------------------------------------------------- remote ops
  applyRemote(op) {
    if (!op?.obj?.id) return;
    if (op.op === "add") {
      if (this.byId.has(op.obj.id)) return;      // duplicate -> ignore
      const obj = this._hydrate(op.obj);
      this.objects.push(obj); this.byId.set(obj.id, obj);
    } else if (op.op === "delete") {
      this.objects = this.objects.filter(o => o.id !== op.obj.id);
      this.byId.delete(op.obj.id);
      this.imgCache.delete(op.obj.id);
    }
    this._invalidate();
  }

  applyLive(authorId, payload) {
    if (!authorId || authorId === this.myId) return;
    this.liveRemote.set(authorId, { ...payload, ts: Date.now() });
    this._invalidate();
  }

  setRemoteCursor(id, info) {
    if (!id || id === this.myId) return;
    this.cursors.set(id, { ...info, ts: Date.now() });
    this._invalidate();
  }

  removeRemoteCursor(id) { this.cursors.delete(id); this._invalidate(); }

  // ------------------------------------------------------------------ camera
  worldToScreen(x, y) {
    return { x: x * this.cam.zoom + this.cam.ox, y: y * this.cam.zoom + this.cam.oy };
  }
  screenToWorld(x, y) {
    return { x: (x - this.cam.ox) / this.cam.zoom, y: (y - this.cam.oy) / this.cam.zoom };
  }
  zoomBy(factor, cx, cy) {
    const before = this.screenToWorld(cx, cy);
    this.cam.zoom = clamp(this.cam.zoom * factor, 0.15, 6);
    const after = this.screenToWorld(cx, cy);
    this.cam.ox += (after.x - before.x) * this.cam.zoom;
    this.cam.oy += (after.y - before.y) * this.cam.zoom;
    this._invalidate();
  }
  fit() {
    const dpr = window.devicePixelRatio || 1;
    const vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
    const zoom = clamp(Math.min(vw / WORLD.w, vh / WORLD.h) * 0.95, 0.15, 2);
    this.cam.zoom = zoom;
    this.cam.ox = (vw - WORLD.w * zoom) / 2;
    this.cam.oy = (vh - WORLD.h * zoom) / 2;
    this._invalidate();
  }
  centerOnContent() {
    const objs = this.objects;
    if (!objs.length) return this.fit();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objs) {
      const b = bboxOf(o);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    const dpr = window.devicePixelRatio || 1;
    const vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
    const pad = 60;
    const zoom = clamp(Math.min(vw / (maxX - minX + pad * 2), vh / (maxY - minY + pad * 2)), 0.15, 3);
    this.cam.zoom = zoom;
    this.cam.ox = vw / 2 - ((minX + maxX) / 2) * zoom;
    this.cam.oy = vh / 2 - ((minY + maxY) / 2) * zoom;
    this._invalidate();
  }

  // ------------------------------------------------------------------ events
  _bind() {
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onWheel = (e) => this._wheel(e);
    this._onKey = (e) => this._key(e);
    this._onResize = () => { this._resize(); };

    this.canvas.addEventListener("pointerdown", this._onDown);
    this.canvas.addEventListener("pointermove", this._onMove);
    this.canvas.addEventListener("pointerup", this._onUp);
    this.canvas.addEventListener("pointercancel", this._onUp);
    this.canvas.addEventListener("pointerleave", this._onUp);
    this.canvas.addEventListener("wheel", this._onWheel, { passive: false });
    window.addEventListener("resize", this._onResize);
    window.addEventListener("keydown", this._onKey);
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  _unbind() {
    this.canvas.removeEventListener("pointerdown", this._onDown);
    this.canvas.removeEventListener("pointermove", this._onMove);
    this.canvas.removeEventListener("pointerup", this._onUp);
    this.canvas.removeEventListener("pointercancel", this._onUp);
    this.canvas.removeEventListener("pointerleave", this._onUp);
    this.canvas.removeEventListener("wheel", this._onWheel);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("keydown", this._onKey);
  }

  _key(e) {
    if (e.target && /INPUT|TEXTAREA|MATH-FIELD/.test(e.target.tagName)) return;
    const map = { d: "pen", h: "highlighter", e: "eraser", t: "text", n: "sticky", r: "rect", o: "ellipse", l: "line", a: "arrow", p: "pan", m: "equation", g: "graph" };
    if (map[e.key?.toLowerCase()]) { this.setTool(map[e.key.toLowerCase()]); this.opts.onToolChange?.(this.tool); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); }
  }

  _pt(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _pointerDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const p = this._pt(e);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2) { this._startPinch(); return; }

    const isPan = this.tool === "pan" || e.button === 1 || e.altKey;
    if (isPan) { this.panning = { sx: p.x, sy: p.y, ox: this.cam.ox, oy: this.cam.oy }; return; }

    const w = this.screenToWorld(p.x, p.y);

    if (this.tool === "eraser") { this._eraseAt(w); this.drawing = { tool: "eraser" }; return; }

    if (["text", "sticky", "equation", "graph", "image"].includes(this.tool)) {
      this.opts.onRequestContent?.(this.tool, w, (objData) => {
        if (!objData) return;
        const obj = { id: randomId(), kind: this.tool, data: objData, author: this.myId, z: Date.now() };
        this.addLocal(obj);
      });
      return;
    }

    if (["pen", "highlighter"].includes(this.tool)) {
      this.drawing = {
        tool: this.tool, color: this.tool === "highlighter" ? withAlpha(this.color, 0.35) : this.color,
        width: this.tool === "highlighter" ? Math.max(this.width * 3, 10) : this.width,
        points: [[w.x, w.y]],
      };
      this._emitLive(true);
      return;
    }

    // shapes
    this.drawing = { tool: this.tool, color: this.color, width: this.width, start: [w.x, w.y], end: [w.x, w.y] };
  }

  _pointerMove(e) {
    const p = this._pt(e);
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2 && this.pinch) { this._movePinch(); return; }

    const w = this.screenToWorld(p.x, p.y);
    this.opts.onCursor?.(w);

    if (this.panning) {
      this.cam.ox = this.panning.ox + (p.x - this.panning.sx);
      this.cam.oy = this.panning.oy + (p.y - this.panning.sy);
      this._invalidate(); return;
    }

    if (!this.drawing) return;

    if (this.drawing.tool === "eraser") { this._eraseAt(w); return; }

    if (this.drawing.points) {
      const last = this.drawing.points[this.drawing.points.length - 1];
      if (Math.hypot(w.x - last[0], w.y - last[1]) > 1.2) {
        this.drawing.points.push([w.x, w.y]);
        this._emitLive(false);
      }
    } else {
      this.drawing.end = [w.x, w.y];
    }
    this._invalidate();
  }

  _pointerUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;

    if (this.panning) { this.panning = null; return; }
    if (!this.drawing) return;

    const d = this.drawing; this.drawing = null;

    if (d.tool === "eraser") { this._invalidate(); return; }

    if (d.points) {
      if (d.points.length < 2) {
        // a dot
        d.points.push([d.points[0][0] + 0.6, d.points[0][1] + 0.6]);
      }
      this.addLocal({ id: randomId(), kind: d.tool === "highlighter" ? "stroke" : "stroke",
        data: { points: d.points, color: d.color, width: d.width, highlighter: d.tool === "highlighter" },
        author: this.myId, z: Date.now() });
      this.liveRemote.delete(this.myId);
      return;
    }

    const [x1, y1] = d.start, [x2, y2] = d.end;
    const x = Math.min(x1, x2), y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    if (w < 3 && h < 3) { this._invalidate(); return; }

    let data;
    if (d.tool === "rect") data = { x, y, w, h, color: d.color, width: d.width };
    else if (d.tool === "ellipse") data = { x, y, w, h, color: d.color, width: d.width };
    else data = { x1, y1, x2, y2, color: d.color, width: d.width };
    this.addLocal({ id: randomId(), kind: d.tool, data, author: this.myId, z: Date.now() });
  }

  _eraseAt(w) {
    const r = 12 / this.cam.zoom;
    const hits = this.objects.filter(o => {
      if (o.author !== this.myId && !this.opts.canEraseOthers) return false;
      const b = bboxOf(o);
      return w.x >= b.x - r && w.x <= b.x + b.w + r && w.y >= b.y - r && w.y <= b.y + b.h + r;
    });
    for (const o of hits) this.deleteLocal(o.id);
  }

  _emitLive = throttle((first) => {
    const d = this.drawing;
    if (!d?.points) return;
    const pts = first ? d.points : d.points.slice(-24);
    this.opts.onLive?.({ kind: "stroke", points: pts, color: d.color, width: d.width, highlighter: d.tool === "highlighter" });
  }, 60);

  _wheel(e) {
    e.preventDefault();
    const p = this._pt(e);
    this.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08, p.x, p.y);
  }

  _startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      ox: this.cam.ox, oy: this.cam.oy, zoom: this.cam.zoom,
    };
  }
  _movePinch() {
    const [a, b] = [...this.pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const factor = d / (this.pinch.d || d);
    this.cam.zoom = clamp(this.pinch.zoom * factor, 0.15, 6);
    this.cam.ox = cx - (this.pinch.cx - this.pinch.ox) * (this.cam.zoom / this.pinch.zoom);
    this.cam.oy = cy - (this.pinch.cy - this.pinch.oy) * (this.cam.zoom / this.pinch.zoom);
    this._invalidate();
  }

  // ----------------------------------------------------------------- render
  _invalidate() { this._dirty = true; }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._invalidate();
  }

  _loop = () => {
    if (this._dirty) { this._dirty = false; this._render(); }
    this._raf = requestAnimationFrame(this._loop);
  };

  _render() {
    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const vw = this.canvas.width / dpr, vh = this.canvas.height / dpr;
    ctx.clearRect(0, 0, vw, vh);

    // board backdrop + grid
    const tl = this.worldToScreen(0, 0);
    const br = this.worldToScreen(WORLD.w, WORLD.h);
    ctx.save();
    ctx.fillStyle = getCss("--panel", "#ffffff");
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = getCss("--border", "#e2e8f0");
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    const step = 100 * this.cam.zoom;
    if (step > 12) {
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let x = 0; x <= WORLD.w; x += 100) { const s = this.worldToScreen(x, 0); ctx.moveTo(s.x, tl.y); ctx.lineTo(s.x, br.y); }
      for (let y = 0; y <= WORLD.h; y += 100) { const s = this.worldToScreen(0, y); ctx.moveTo(tl.x, s.y); ctx.lineTo(br.x, s.y); }
      ctx.strokeStyle = getCss("--border", "#e2e8f0");
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    const sorted = [...this.objects].sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const o of sorted) this._drawObject(o);

    // ephemeral remote live strokes
    const now = Date.now();
    for (const [id, live] of this.liveRemote) {
      if (now - live.ts > LIVE_TTL) { this.liveRemote.delete(id); continue; }
      this._drawStroke(live.points, live.color, live.width, live.highlighter, 0.85);
    }

    // in-progress local stroke
    if (this.drawing?.points) this._drawStroke(this.drawing.points, this.drawing.color, this.drawing.width, this.drawing.tool === "highlighter");
    if (this.drawing && this.drawing.start) this._drawShapePreview(this.drawing);

    // remote cursors
    for (const [id, c] of this.cursors) {
      if (now - c.ts > CURSOR_TTL) { this.cursors.delete(id); continue; }
      const s = this.worldToScreen(c.x, c.y);
      ctx.save();
      ctx.fillStyle = c.color || "#0ea5a4";
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
      if (c.name) {
        ctx.font = "600 12px system-ui, sans-serif";
        const w = ctx.measureText(c.name).width + 12;
        ctx.fillStyle = c.color || "#0ea5a4";
        ctx.globalAlpha = 0.9;
        roundRect(ctx, s.x + 8, s.y - 20, w, 20, 6); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#04211f";
        ctx.fillText(c.name, s.x + 14, s.y - 6);
      }
      ctx.restore();
    }
  }

  _drawObject(o) {
    const ctx = this.ctx;
    const d = o.data;
    switch (o.kind) {
      case "stroke": this._drawStroke(d.points, d.color, d.width, d.highlighter); break;
      case "rect": {
        const p = this.worldToScreen(d.x, d.y);
        ctx.save(); ctx.strokeStyle = d.color; ctx.lineWidth = d.width * this.cam.zoom;
        ctx.strokeRect(p.x, p.y, d.w * this.cam.zoom, d.h * this.cam.zoom); ctx.restore(); break;
      }
      case "ellipse": {
        const p = this.worldToScreen(d.x + d.w / 2, d.y + d.h / 2);
        ctx.save(); ctx.strokeStyle = d.color; ctx.lineWidth = d.width * this.cam.zoom;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.abs(d.w * this.cam.zoom) / 2, Math.abs(d.h * this.cam.zoom) / 2, 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.restore(); break;
      }
      case "line": case "arrow": this._drawLine(o); break;
      case "text": this._drawText(d, o); break;
      case "sticky": this._drawSticky(d, o); break;
      case "image": this._drawImage(o); break;
      case "equation": this._drawEquation(o); break;
      case "graph": this._drawGraph(o); break;
    }
  }

  _drawStroke(points, color, width, highlighter, alpha = 1) {
    if (!points?.length) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, width * this.cam.zoom);
    ctx.globalAlpha = alpha * (highlighter ? 0.4 : 1);
    ctx.beginPath();
    const p0 = this.worldToScreen(points[0][0], points[0][1]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < points.length; i++) {
      const p = this.worldToScreen(points[i][0], points[i][1]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawLine(o) {
    const d = o.data, ctx = this.ctx;
    const a = this.worldToScreen(d.x1, d.y1), b = this.worldToScreen(d.x2, d.y2);
    ctx.save(); ctx.strokeStyle = d.color; ctx.lineWidth = Math.max(1, d.width * this.cam.zoom);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (o.kind === "arrow") {
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const size = Math.max(8, 12 * this.cam.zoom);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - size * Math.cos(ang - 0.4), b.y - size * Math.sin(ang - 0.4));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - size * Math.cos(ang + 0.4), b.y - size * Math.sin(ang + 0.4));
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawText(d, o) {
    const ctx = this.ctx;
    const p = this.worldToScreen(d.x, d.y);
    const size = (d.size || 24) * this.cam.zoom;
    ctx.save();
    ctx.fillStyle = d.color || "#0f2540";
    ctx.font = `${d.bold ? "700 " : ""}${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const lines = String(d.text || "").split("\n");
    lines.forEach((ln, i) => ctx.fillText(ln, p.x, p.y + i * size * 1.25));
    ctx.restore();
  }

  _drawSticky(d, o) {
    const ctx = this.ctx;
    const p = this.worldToScreen(d.x, d.y);
    const w = d.w * this.cam.zoom, h = d.h * this.cam.zoom;
    ctx.save();
    ctx.fillStyle = d.color || "#fde68a";
    ctx.strokeStyle = "rgba(0,0,0,.12)";
    roundRect(ctx, p.x, p.y, w, h, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#1f2937";
    const size = (d.size || 16) * this.cam.zoom;
    ctx.font = `${size}px system-ui, sans-serif`;
    ctx.textBaseline = "top";
    const pad = 8 * this.cam.zoom;
    wrapText(ctx, String(d.text || ""), p.x + pad, p.y + pad, w - pad * 2, size * 1.3);
    ctx.restore();
  }

  _drawImage(o) {
    const img = this._imageFor(o);
    if (!img || !img.complete) return;
    const p = this.worldToScreen(o.data.x, o.data.y);
    this.ctx.drawImage(img, p.x, p.y, o.data.w * this.cam.zoom, o.data.h * this.cam.zoom);
  }

  _imageFor(o) {
    if (this.imgCache.has(o.id)) return this.imgCache.get(o.id);
    const img = new Image();
    img.onload = () => this._invalidate();
    img.src = o.data.src;
    this.imgCache.set(o.id, img);
    return img;
  }

  _drawEquation(o) {
    if (!o.data.svg) return;
    const img = this._imageFor(o);
    if (!img.complete) return;
    const p = this.worldToScreen(o.data.x, o.data.y);
    const w = (o.data.w || 200) * this.cam.zoom;
    const h = (o.data.h || 60) * this.cam.zoom;
    this.ctx.drawImage(img, p.x, p.y, w, h);
  }

  _drawGraph(o) {
    const ctx = this.ctx;
    const d = o.data;
    const p = this.worldToScreen(d.x, d.y);
    const W = d.w * this.cam.zoom, H = d.h * this.cam.zoom;
    ctx.save();
    ctx.fillStyle = getCss("--panel", "#fff");
    roundRect(ctx, p.x, p.y, W, H, 8); ctx.fill();
    ctx.strokeStyle = getCss("--border", "#e2e8f0"); ctx.stroke();
    ctx.beginPath(); ctx.rect(p.x, p.y, W, H); ctx.clip();

    const { xmin = -10, xmax = 10, ymin = -10, ymax = 10, expr = "x" } = d;
    const X = (x) => p.x + ((x - xmin) / (xmax - xmin)) * W;
    const Y = (y) => p.y + H - ((y - ymin) / (ymax - ymin)) * H;

    ctx.strokeStyle = getCss("--border", "#e2e8f0"); ctx.lineWidth = 1;
    ctx.beginPath();
    if (ymin < 0 && ymax > 0) { ctx.moveTo(p.x, Y(0)); ctx.lineTo(p.x + W, Y(0)); }
    if (xmin < 0 && xmax > 0) { ctx.moveTo(X(0), p.y); ctx.lineTo(X(0), p.y + H); }
    ctx.stroke();

    ctx.strokeStyle = getCss("--accent", "#0ea5a4"); ctx.lineWidth = Math.max(1.5, 2 * this.cam.zoom);
    ctx.beginPath();
    let started = false;
    const N = Math.min(600, Math.max(120, Math.floor(W)));
    for (let i = 0; i <= N; i++) {
      const x = xmin + (i / N) * (xmax - xmin);
      const y = safeEval(expr, x);
      if (!isFinite(y)) { started = false; continue; }
      const sx = X(x), sy = Y(y);
      if (sy < p.y - H || sy > p.y + 2 * H) { started = false; continue; }
      if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawShapePreview(d) {
    const ctx = this.ctx;
    const a = this.worldToScreen(...d.start), b = this.worldToScreen(...d.end);
    ctx.save();
    ctx.strokeStyle = d.color; ctx.lineWidth = Math.max(1, d.width * this.cam.zoom);
    ctx.setLineDash([6, 4]);
    if (d.tool === "rect") ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    else if (d.tool === "ellipse") { ctx.beginPath(); ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.restore();
  }

  // ---------------------------------------------------------------- export
  async renderToBlob({ scale = 2 } = {}) {
    const objs = this.objects;
    let minX = 0, minY = 0, maxX = WORLD.w, maxY = WORLD.h;
    if (objs.length) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      for (const o of objs) {
        const b = bboxOf(o);
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
      }
      const pad = 40; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    }
    const out = document.createElement("canvas");
    out.width = Math.round((maxX - minX) * scale);
    out.height = Math.round((maxY - minY) * scale);
    const octx = out.getContext("2d");
    octx.fillStyle = "#ffffff"; octx.fillRect(0, 0, out.width, out.height);

    // temporarily render into the export transform
    const saved = { cam: { ...this.cam }, ctx: this.ctx };
    this.ctx = octx;
    this.cam = { ox: -minX * scale, oy: -minY * scale, zoom: scale };
    for (const o of [...objs].sort((a, b) => (a.z || 0) - (b.z || 0))) this._drawObject(o);
    this.ctx = saved.ctx; this.cam = saved.cam;
    this._invalidate();

    return await new Promise((res) => out.toBlob(res, "image/png"));
  }
}

// ------------------------------------------------------------------- helpers
export function bboxOf(o) {
  const d = o.data || {};
  switch (o.kind) {
    case "stroke": {
      const xs = d.points.map(p => p[0]), ys = d.points.map(p => p[1]);
      const pad = (d.width || 2) / 2;
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
               w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    }
    case "line": case "arrow":
      return { x: Math.min(d.x1, d.x2), y: Math.min(d.y1, d.y2),
               w: Math.abs(d.x2 - d.x1), h: Math.abs(d.y2 - d.y1) };
    case "text":
      return { x: d.x, y: d.y, w: (d.text || "").length * (d.size || 24) * 0.6, h: (d.size || 24) * 1.3 };
    default:
      return { x: d.x || 0, y: d.y || 0, w: d.w || 60, h: d.h || 40 };
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const words = text.split(/\s+/);
  let line = "", yy = y;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, yy); line = word; yy += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, yy);
}

function getCss(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function withAlpha(hex, a) {
  if (!/^#([0-9a-f]{6})$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ------------------------------------------------------------- safe evaluator
// Tiny expression parser for graph plotting. No eval() — arithmetic and a
// whitelist of functions only. Variable is `x`.
export function safeEval(expr, x) {
  try {
    const tokens = tokenize(String(expr));
    const parser = { i: 0, t: tokens, x };
    const val = parseExpr(parser, 0);
    return val;
  } catch { return NaN; }
}

function tokenize(s) {
  const out = [];
  const re = /\s*([0-9]*\.?[0-9]+|[a-zA-Z_]+|\*\*|[+\-*/^(),])/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1]);
  return out;
}

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt, abs: Math.abs,
  log: Math.log10, ln: Math.log, exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
};
const CONSTS = { pi: Math.PI, e: Math.E };

function parseExpr(p, minPrec) {
  let left = parseUnary(p);
  for (;;) {
    const op = p.t[p.i];
    const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "^": 3, "**": 3 }[op];
    if (prec == null || prec < minPrec) break;
    p.i++;
    const right = parseExpr(p, op === "^" || op === "**" ? prec : prec + 1);
    left = apply(op, left, right);
  }
  return left;
}
function parseUnary(p) {
  const t = p.t[p.i];
  if (t === "-") { p.i++; return -parseUnary(p); }
  if (t === "+") { p.i++; return parseUnary(p); }
  return parseAtom(p);
}
function parseAtom(p) {
  const t = p.t[p.i];
  if (t === undefined) throw new Error("eof");
  if (t === "(") { p.i++; const v = parseExpr(p, 0); if (p.t[p.i] === ")") p.i++; return v; }
  if (/^[0-9]/.test(t)) { p.i++; return parseFloat(t); }
  if (/^[a-zA-Z_]/.test(t)) {
    p.i++;
    const name = t.toLowerCase();
    if (name === "x") return p.x;
    if (name in CONSTS) return CONSTS[name];
    if (name in FUNCS) {
      let arg;
      if (p.t[p.i] === "(") { p.i++; arg = parseExpr(p, 0); if (p.t[p.i] === ")") p.i++; }
      else arg = parseUnary(p);
      return FUNCS[name](arg);
    }
    throw new Error("unknown " + name);
  }
  throw new Error("unexpected " + t);
}
function apply(op, a, b) {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "^": case "**": return Math.pow(a, b);
  }
  return NaN;
}
